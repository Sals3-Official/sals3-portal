import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
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
 * Read model for **All Supplier Products**, served entirely from the Sals3
 * database.
 *
 * The page previously called CJ `/product/list` on every render, search
 * keystroke, filter change, and page turn. Under the owner's CJ call-budget
 * decision (ADR-013 §1a) it must not: browsing, filtering, searching, paging,
 * and opening the source drawer are all local reads of what discovery already
 * persisted. Nothing in this module can reach a supplier adapter - it imports
 * none.
 *
 * Every query is seller-scoped in the same `WHERE` clause as its lookup, by
 * joining `supplier_candidates.supplier_connection_id ->
 * supplier_connections.seller_account_id` (ADR-008) - never the legacy
 * `intended_seller_id` text field, and never a separate check-then-fetch.
 */

export const SUPPLIER_PRODUCTS_PAGE_SIZE = 50;
const MAX_ROWS_PER_REQUEST = 200;
/** Below this, a search is not submitted at all - see the search input. */
export const MIN_SEARCH_LENGTH = 2;
/** Bounded so one seller's very long tail cannot build an unbounded select. */
const MAX_CATEGORY_FACETS = 200;

export type SupplierProductsQuickView =
  'all' | 'cj-trending' | 'most-listed' | 'new-arrivals' | 'needs-attention';

export type DiscoverySignalFilter = DiscoverySignal | 'ALL' | 'NONE';

export type SupplierProductsFilters = {
  quickView: SupplierProductsQuickView;
  signal: DiscoverySignalFilter;
  categoryId: string | null;
  search: string;
  page: number;
};

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

export type SupplierProductsPage = {
  rows: SupplierProductRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** `%` and `_` are LIKE wildcards and `\` escapes them - a typed one means the literal character. */
function escapeLikePattern(term: string) {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Whitespace-normalized search term, or `''` when it is below the minimum
 * meaningful length. Returning `''` is what makes a one-character input leave
 * the scoped result set completely intact rather than filtering it.
 */
export function normalizeSearchTerm(raw: string | undefined | null): string {
  const collapsed = (raw ?? '').trim().replace(/\s+/g, ' ');

  return collapsed.length < MIN_SEARCH_LENGTH ? '' : collapsed;
}

/**
 * Case-insensitive substring match over every identifier the search box
 * advertises, executed in SQL against the whole scoped set - never against
 * the current page in JavaScript, which would report "no matches" for a hit
 * sitting past the first page.
 *
 * Parameterized by Drizzle: the term always travels as a bind parameter and
 * its LIKE wildcards are escaped, so the debounce and minimum length are a
 * request-volume control, never the security boundary.
 */
export function supplierProductsSearchCondition(
  search: string,
): SQL | undefined {
  const term = normalizeSearchTerm(search);

  if (term === '') return undefined;

  const pattern = `%${escapeLikePattern(term)}%`;

  return sql`(${ilike(supplierCandidates.externalProductId, pattern)}
    OR ${candidateEvaluations.feedSnapshot}->>'name' ILIKE ${pattern}
    OR ${candidateEvaluations.feedSnapshot}->>'sku' ILIKE ${pattern})`;
}

/**
 * Rows a seller should act on: a manual inspection found no inventory or
 * could not verify it, or the pipeline itself is blocked/failed. An
 * uninspected `STOCK_NOT_CHECKED` row is an honest unknown and deliberately
 * NOT attention - inventing a queue of things nobody has looked at yet would
 * be the same fabrication this whole change removes.
 */
function needsAttentionCondition(): SQL {
  return sql`(${inArray(supplierCandidates.stockReviewState, [
    'MANUALLY_NO_INVENTORY',
    'MANUALLY_COULD_NOT_VERIFY',
  ])}
    OR ${inArray(candidateEvaluations.status, [
      'PASS_WITH_ATTENTION',
      'EVALUATION_FAILED',
    ])})`;
}

function signalExists(signal: DiscoverySignal): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${candidateDiscoverySignals}
    WHERE ${candidateDiscoverySignals.candidateId} = ${supplierCandidates.id}
      AND ${candidateDiscoverySignals.signal} = ${signal}
  )`;
}

function noSignalExists(): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${candidateDiscoverySignals}
    WHERE ${candidateDiscoverySignals.candidateId} = ${supplierCandidates.id}
  )`;
}

const QUICK_VIEW_SIGNAL: Partial<
  Record<SupplierProductsQuickView, DiscoverySignal>
> = {
  'cj-trending': 'CJ_TRENDING',
  'most-listed': 'CJ_HIGH_LISTED',
  'new-arrivals': 'CJ_NEW_ARRIVAL',
};

function scopeFor(
  sellerAccountId: string,
  filters: SupplierProductsFilters,
): SQL | undefined {
  const quickViewSignal = QUICK_VIEW_SIGNAL[filters.quickView];
  const conditions: (SQL | undefined)[] = [
    eq(supplierConnections.sellerAccountId, sellerAccountId),
    supplierProductsSearchCondition(filters.search),
  ];

  if (quickViewSignal !== undefined) {
    conditions.push(signalExists(quickViewSignal));
  }

  if (filters.quickView === 'needs-attention') {
    conditions.push(needsAttentionCondition());
  }

  if (filters.signal === 'NONE') {
    conditions.push(noSignalExists());
  } else if (filters.signal !== 'ALL') {
    conditions.push(signalExists(filters.signal));
  }

  if (filters.categoryId !== null) {
    conditions.push(
      eq(supplierCandidates.providerCategoryId, filters.categoryId),
    );
  }

  return and(...conditions);
}

/**
 * Newest sighting first, with the candidate id as a tiebreaker. The
 * tiebreaker is load-bearing for paging, not cosmetic: one discovery cycle
 * stamps thousands of rows with the same instant, and ordering by that column
 * alone leaves their relative order undefined - the same row could then
 * appear on two pages while another is skipped.
 */
const PAGE_ORDER = [
  desc(supplierCandidates.createdAt),
  asc(supplierCandidates.id),
] as const;

function boundedPageSize(pageSize: number | undefined): number {
  return Math.min(
    Math.max(pageSize ?? SUPPLIER_PRODUCTS_PAGE_SIZE, 1),
    MAX_ROWS_PER_REQUEST,
  );
}

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

async function countRows(scope: SQL | undefined): Promise<number> {
  const rows = await getDb()
    .select({ total: count() })
    .from(supplierCandidates)
    .innerJoin(
      candidateEvaluations,
      eq(candidateEvaluations.candidateId, supplierCandidates.id),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(scope);

  return Number(rows[0]?.total ?? 0);
}

export async function listSupplierProducts(
  sellerAccountId: string,
  filters: SupplierProductsFilters,
  options: { pageSize?: number } = {},
): Promise<SupplierProductsPage> {
  const pageSize = boundedPageSize(options.pageSize);
  const scope = scopeFor(sellerAccountId, filters);
  const total = await countRows(scope);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamped, so a hand-edited `?page=9999` shows the last real page instead
  // of an empty table that looks like "no results".
  const page = Math.min(Math.max(filters.page, 1), totalPages);
  const rows = await fetchRows(scope, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return { rows, total, page, pageSize, totalPages };
}

export type CategoryFacet = { id: string; name: string; total: number };

/**
 * Category options for the table filter bar, built from the provider category
 * already persisted on this seller's own rows. Deliberately a grouped count
 * over the Sals3 database: CJ is never called to populate or apply this
 * filter, and a seller only ever sees categories present in their own scope.
 */
export async function listSupplierProductCategories(
  sellerAccountId: string,
): Promise<CategoryFacet[]> {
  const rows = await getDb()
    .select({
      id: supplierCandidates.providerCategoryId,
      name: supplierCandidates.providerCategoryName,
      total: count(),
    })
    .from(supplierCandidates)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        isNotNull(supplierCandidates.providerCategoryId),
        ne(supplierCandidates.providerCategoryId, ''),
      ),
    )
    .groupBy(
      supplierCandidates.providerCategoryId,
      supplierCandidates.providerCategoryName,
    )
    .orderBy(asc(supplierCandidates.providerCategoryName))
    .limit(MAX_CATEGORY_FACETS);

  return rows
    .filter((row): row is { id: string; name: string | null; total: number } =>
      Boolean(row.id),
    )
    .map((row) => ({
      id: row.id,
      name: row.name ?? row.id,
      total: Number(row.total),
    }));
}

export type SupplierProductsSummary = {
  total: number;
  stockNotChecked: number;
  manuallyInStock: number;
  needsAttention: number;
};

/**
 * Header counters. Grouped counts, not a row fetch: this renders on every
 * visit to a page that can hold tens of thousands of rows.
 */
export async function summariseSupplierProducts(
  sellerAccountId: string,
): Promise<SupplierProductsSummary> {
  const db = getDb();
  const scoped = and(eq(supplierConnections.sellerAccountId, sellerAccountId));

  const [totals, attention] = await Promise.all([
    db
      .select({
        state: supplierCandidates.stockReviewState,
        total: count(),
      })
      .from(supplierCandidates)
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
      )
      .where(scoped)
      .groupBy(supplierCandidates.stockReviewState),
    db
      .select({ total: count() })
      .from(supplierCandidates)
      .innerJoin(
        candidateEvaluations,
        eq(candidateEvaluations.candidateId, supplierCandidates.id),
      )
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
      )
      .where(and(scoped, needsAttentionCondition())),
  ]);

  const byState = new Map(
    totals.map((row) => [row.state, Number(row.total)] as const),
  );

  return {
    total: [...byState.values()].reduce((sum, value) => sum + value, 0),
    stockNotChecked: byState.get('STOCK_NOT_CHECKED') ?? 0,
    manuallyInStock: byState.get('MANUALLY_IN_STOCK') ?? 0,
    needsAttention: Number(attention[0]?.total ?? 0),
  };
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
