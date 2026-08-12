import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  candidateStockAttestations,
  supplierCandidates,
  supplierConnections,
  type CandidateStockAttestationRow,
  type StockReviewState,
} from '@/lib/db/schema';

/**
 * Manual stock attestation writes (ADR-013 §1a).
 *
 * An attestation records what a person saw on CJ/MyCJ. It is never labelled
 * CJ API-verified evidence, it spends no supplier points, and no automated
 * path may produce one - only an authorized actor through the server action.
 *
 * Two guarantees the callers rely on:
 *
 * 1. The tenant filter is inside the same `UPDATE ... WHERE` as the row
 *    lookup, so a cross-tenant candidate id can never be written, not even
 *    between a check and a write.
 * 2. `stockReviewVersion` is a compare-and-set token. A duplicate submit or a
 *    stale form (someone else recorded an inspection since the page
 *    rendered) matches no row and is rejected, rather than silently
 *    overwriting a newer observation.
 */

export type RecordAttestationInput = {
  candidateId: string;
  sellerAccountId: string;
  state: StockReviewState;
  actorId: string;
  observedAt: Date;
  observedQuantity: number | null;
  observedOrigin: string | null;
  note: string | null;
  /** The version the submitting page rendered. */
  expectedVersion: number;
};

export type RecordAttestationOutcome =
  | { ok: true; newVersion: number }
  | { ok: false; reason: 'not_found_or_stale' };

export async function recordStockAttestation(
  executor: DbExecutor,
  input: RecordAttestationInput,
): Promise<RecordAttestationOutcome> {
  const now = new Date();
  const updated = await executor
    .update(supplierCandidates)
    .set({
      stockReviewState: input.state,
      stockReviewVersion: sql`${supplierCandidates.stockReviewVersion} + 1`,
      stockReviewObservedAt: input.observedAt,
      stockReviewRecordedAt: now,
      stockReviewActorId: input.actorId,
      stockReviewObservedQuantity: input.observedQuantity,
      stockReviewObservedOrigin: input.observedOrigin,
      stockReviewNote: input.note,
      updatedAt: now,
    })
    .where(
      and(
        eq(supplierCandidates.id, input.candidateId),
        eq(supplierCandidates.stockReviewVersion, input.expectedVersion),
        // Tenant scope resolved in the same statement (ADR-008): the
        // candidate must belong to a connection owned by this seller.
        sql`EXISTS (
          SELECT 1 FROM ${supplierConnections}
          WHERE ${supplierConnections.id} = ${supplierCandidates.supplierConnectionId}
            AND ${supplierConnections.sellerAccountId} = ${input.sellerAccountId}
        )`,
      ),
    )
    .returning({ version: supplierCandidates.stockReviewVersion });

  const row = updated[0];

  if (row === undefined) return { ok: false, reason: 'not_found_or_stale' };

  await executor.insert(candidateStockAttestations).values({
    candidateId: input.candidateId,
    state: input.state,
    actorId: input.actorId,
    observedAt: input.observedAt,
    observedQuantity: input.observedQuantity,
    observedOrigin: input.observedOrigin,
    note: input.note,
    supersededVersion: input.expectedVersion,
  });

  return { ok: true, newVersion: row.version };
}

/**
 * Attestation history for the read-only Supplier Source Details drawer,
 * newest first and bounded. Seller-scoped in the same `WHERE` as the lookup.
 */
export async function listStockAttestations(
  executor: DbExecutor,
  input: { candidateId: string; sellerAccountId: string; limit?: number },
): Promise<CandidateStockAttestationRow[]> {
  return executor
    .select({
      id: candidateStockAttestations.id,
      candidateId: candidateStockAttestations.candidateId,
      state: candidateStockAttestations.state,
      actorId: candidateStockAttestations.actorId,
      observedAt: candidateStockAttestations.observedAt,
      observedQuantity: candidateStockAttestations.observedQuantity,
      observedOrigin: candidateStockAttestations.observedOrigin,
      note: candidateStockAttestations.note,
      supersededVersion: candidateStockAttestations.supersededVersion,
      createdAt: candidateStockAttestations.createdAt,
    })
    .from(candidateStockAttestations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateStockAttestations.candidateId),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(
      and(
        eq(candidateStockAttestations.candidateId, input.candidateId),
        eq(supplierConnections.sellerAccountId, input.sellerAccountId),
      ),
    )
    .orderBy(sql`${candidateStockAttestations.createdAt} DESC`)
    .limit(Math.min(Math.max(input.limit ?? 20, 1), 100));
}
