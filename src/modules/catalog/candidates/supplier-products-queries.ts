import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  candidateDiscoverySignals,
  candidateEvaluations,
  supplierCandidates,
  supplierConnections,
  type DiscoverySignal,
  type StockReviewState,
} from '@/lib/db/schema';
import { feedSnapshotSchema } from './rules/contracts';
import type { EvaluationStatus } from './rules/contracts';

/**
 * Pipeline read model for **All Supplier Products**.
 *
 * The page's product rows now come from a live CJ `/product/list` read (owner
 * decision 2026-08-13, see `live-browse.ts`); this module supplies only the
 * Sals3-side pipeline data laid over those rows - which live products are
 * already discovered candidates, their screening outcome, discovery signals,
 * and manual stock review - plus the read for the Source Details drawer.
 * Nothing in this module can reach a supplier adapter - it imports none, and
 * nothing here ever writes: browsing must never create or refresh a
 * candidate.
 *
 * Every query is seller-scoped in the same `WHERE` clause as its lookup, by
 * joining `supplier_candidates.supplier_connection_id ->
 * supplier_connections.seller_account_id` (ADR-008) - never the legacy
 * `intended_seller_id` text field, and never a separate check-then-fetch.
 */

/** Hard bound on one pid-match lookup - the live page size is at most 200. */
const MAX_MATCH_IDS = 200;

export type SupplierProductRow = {
  candidateId: string;
  externalProductId: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  priceUsdCents: number | null;
  listedCount: number | null;
  shipsFrom: string[];
  weight: string | null;
  freeShipping: boolean;
  providerCreatedAt: string | null;
  supplierName: string | null;
  status: EvaluationStatus;
  reasonCodes: string[];
  attemptCount: number;
  lastErrorCode: string | null;
  evaluatedAt: Date | null;
  discoveredAt: Date;
  providerLastSeenAt: Date | null;
  stockReview: {
    state: StockReviewState;
    version: number;
    observedAt: Date | null;
    recordedAt: Date | null;
    actorId: string | null;
    observedQuantity: number | null;
    observedOrigin: string | null;
    note: string | null;
  };
  signals: DiscoverySignal[];
};

/**
 * Newest sighting first, with the candidate id as a tiebreaker - deterministic
 * even when one discovery cycle stamps thousands of rows with the same
 * instant.
 */
const PAGE_ORDER = [
  desc(supplierCandidates.createdAt),
  asc(supplierCandidates.id),
] as const;

async function loadSignals(
  candidateIds: string[],
): Promise<Map<string, DiscoverySignal[]>> {
  if (candidateIds.length === 0) return new Map();

  const rows = await getDb()
    .select({
      candidateId: candidateDiscoverySignals.candidateId,
      signal: candidateDiscoverySignals.signal,
    })
    .from(candidateDiscoverySignals)
    .where(inArray(candidateDiscoverySignals.candidateId, candidateIds));

  const grouped = new Map<string, DiscoverySignal[]>();

  rows.forEach((row) => {
    const existing = grouped.get(row.candidateId);

    if (existing === undefined) grouped.set(row.candidateId, [row.signal]);
    else existing.push(row.signal);
  });

  return grouped;
}

async function fetchRows(
  scope: SQL | undefined,
  input: { limit: number; offset: number },
): Promise<SupplierProductRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      candidateId: supplierCandidates.id,
      externalProductId: supplierCandidates.externalProductId,
      providerCategoryId: supplierCandidates.providerCategoryId,
      providerCategoryName: supplierCandidates.providerCategoryName,
      discoveredAt: supplierCandidates.createdAt,
      providerLastSeenAt: supplierCandidates.providerLastSeenAt,
      stockReviewState: supplierCandidates.stockReviewState,
      stockReviewVersion: supplierCandidates.stockReviewVersion,
      stockReviewObservedAt: supplierCandidates.stockReviewObservedAt,
      stockReviewRecordedAt: supplierCandidates.stockReviewRecordedAt,
      stockReviewActorId: supplierCandidates.stockReviewActorId,
      stockReviewObservedQuantity:
        supplierCandidates.stockReviewObservedQuantity,
      stockReviewObservedOrigin: supplierCandidates.stockReviewObservedOrigin,
      stockReviewNote: supplierCandidates.stockReviewNote,
      status: candidateEvaluations.status,
      reasonCodes: candidateEvaluations.reasonCodes,
      attemptCount: candidateEvaluations.attemptCount,
      lastErrorCode: candidateEvaluations.lastErrorCode,
      evaluatedAt: candidateEvaluations.evaluatedAt,
      feedSnapshot: candidateEvaluations.feedSnapshot,
    })
    .from(supplierCandidates)
    .innerJoin(
      candidateEvaluations,
      eq(candidateEvaluations.candidateId, supplierCandidates.id),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(scope)
    .orderBy(...PAGE_ORDER)
    .limit(input.limit)
    .offset(input.offset);

  const signalsByCandidate = await loadSignals(
    rows.map((row) => row.candidateId),
  );

  return rows.map((row) => {
    const feed = feedSnapshotSchema.safeParse(row.feedSnapshot);
    const snapshot = feed.success ? feed.data : null;

    return {
      candidateId: row.candidateId,
      externalProductId: row.externalProductId,
      name: snapshot?.name ?? 'Unnamed product',
      sku: snapshot?.sku ?? null,
      imageUrl: snapshot?.imageUrl ?? null,
      categoryId: row.providerCategoryId ?? snapshot?.categoryId ?? null,
      categoryName: row.providerCategoryName ?? snapshot?.category ?? null,
      priceUsdCents: snapshot?.priceUsdCents ?? null,
      listedCount: snapshot?.listedCount ?? null,
      shipsFrom: snapshot?.shipsFrom ?? [],
      weight: snapshot?.weight ?? null,
      freeShipping: snapshot?.freeShipping ?? false,
      providerCreatedAt: snapshot?.providerCreatedAt ?? null,
      supplierName: snapshot?.supplierName ?? null,
      status: row.status,
      reasonCodes: row.reasonCodes,
      attemptCount: row.attemptCount,
      lastErrorCode: row.lastErrorCode,
      evaluatedAt: row.evaluatedAt,
      discoveredAt: row.discoveredAt,
      providerLastSeenAt: row.providerLastSeenAt,
      stockReview: {
        state: row.stockReviewState,
        version: row.stockReviewVersion,
        observedAt: row.stockReviewObservedAt,
        recordedAt: row.stockReviewRecordedAt,
        actorId: row.stockReviewActorId,
        observedQuantity: row.stockReviewObservedQuantity,
        observedOrigin: row.stockReviewObservedOrigin,
        note: row.stockReviewNote,
      },
      signals: signalsByCandidate.get(row.candidateId) ?? [],
    };
  });
}

export type SupplierProductMatch = {
  candidateId: string;
  externalProductId: string;
  /** Null when the candidate is discovered but not yet evaluated. */
  status: EvaluationStatus | null;
  reasonCodes: string[];
  attemptCount: number;
  lastErrorCode: string | null;
  evaluatedAt: Date | null;
  discoveredAt: Date;
  stockReview: SupplierProductRow['stockReview'];
  signals: DiscoverySignal[];
};

/**
 * Pipeline overlay for one live browse page: which of these provider product
 * ids are already discovered candidates for this seller, keyed by pid. A
 * LEFT JOIN on `candidate_evaluations` on purpose - a candidate discovery has
 * inserted but not yet evaluated must still match, with a null status, rather
 * than rendering as "not discovered". Pure read: browsing never creates or
 * refreshes a candidate.
 */
export async function findPipelineMatchesByPid(
  sellerAccountId: string,
  externalProductIds: string[],
): Promise<Map<string, SupplierProductMatch>> {
  const pids = [...new Set(externalProductIds)]
    .filter((pid) => pid !== '')
    .slice(0, MAX_MATCH_IDS);

  if (pids.length === 0) return new Map();

  const rows = await getDb()
    .select({
      candidateId: supplierCandidates.id,
      externalProductId: supplierCandidates.externalProductId,
      discoveredAt: supplierCandidates.createdAt,
      stockReviewState: supplierCandidates.stockReviewState,
      stockReviewVersion: supplierCandidates.stockReviewVersion,
      stockReviewObservedAt: supplierCandidates.stockReviewObservedAt,
      stockReviewRecordedAt: supplierCandidates.stockReviewRecordedAt,
      stockReviewActorId: supplierCandidates.stockReviewActorId,
      stockReviewObservedQuantity:
        supplierCandidates.stockReviewObservedQuantity,
      stockReviewObservedOrigin: supplierCandidates.stockReviewObservedOrigin,
      stockReviewNote: supplierCandidates.stockReviewNote,
      status: candidateEvaluations.status,
      reasonCodes: candidateEvaluations.reasonCodes,
      attemptCount: candidateEvaluations.attemptCount,
      lastErrorCode: candidateEvaluations.lastErrorCode,
      evaluatedAt: candidateEvaluations.evaluatedAt,
    })
    .from(supplierCandidates)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .leftJoin(
      candidateEvaluations,
      eq(candidateEvaluations.candidateId, supplierCandidates.id),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        inArray(supplierCandidates.externalProductId, pids),
      ),
    );

  const signalsByCandidate = await loadSignals(
    rows.map((row) => row.candidateId),
  );

  const matches = new Map<string, SupplierProductMatch>();

  rows.forEach((row) => {
    matches.set(row.externalProductId, {
      candidateId: row.candidateId,
      externalProductId: row.externalProductId,
      status: row.status,
      reasonCodes: row.reasonCodes ?? [],
      attemptCount: row.attemptCount ?? 0,
      lastErrorCode: row.lastErrorCode,
      evaluatedAt: row.evaluatedAt,
      discoveredAt: row.discoveredAt,
      stockReview: {
        state: row.stockReviewState,
        version: row.stockReviewVersion,
        observedAt: row.stockReviewObservedAt,
        recordedAt: row.stockReviewRecordedAt,
        actorId: row.stockReviewActorId,
        observedQuantity: row.stockReviewObservedQuantity,
        observedOrigin: row.stockReviewObservedOrigin,
        note: row.stockReviewNote,
      },
      signals: signalsByCandidate.get(row.candidateId) ?? [],
    });
  });

  return matches;
}

/**
 * One candidate, scoped to its owning seller, for the read-only Supplier
 * Source Details drawer. Returns null for another seller's row and for a
 * missing row alike, so a probe cannot distinguish the two.
 */
export async function findSupplierProductForSeller(
  sellerAccountId: string,
  candidateId: string,
): Promise<SupplierProductRow | null> {
  const rows = await fetchRows(
    and(
      eq(supplierConnections.sellerAccountId, sellerAccountId),
      eq(supplierCandidates.id, candidateId),
    ),
    { limit: 1, offset: 0 },
  );

  return rows[0] ?? null;
}
