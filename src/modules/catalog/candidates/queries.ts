import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  candidateEvaluations,
  supplierCandidates,
  supplierConnections,
  supplierSnapshots,
  type CandidateEvaluationRow,
} from '@/lib/db/schema';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import type { EvaluationStatus } from './rules/contracts';
import { MAX_EVALUATION_ATTEMPTS } from './rules/policy';

/**
 * Read side of the candidate pipeline. Kept separate from `repository.ts`
 * (which serves the write use cases) so a read path can never reach a
 * mutation helper by accident.
 *
 * Every seller-facing query filters by `sellerAccountId`, resolved by
 * joining through `supplierCandidates.supplierConnectionId ->
 * supplierConnections.sellerAccountId` (ADR-008) - never the legacy
 * `intendedSellerId` text field, which nothing here treats as the source
 * of truth for tenant scoping anymore. The filter lives in the same
 * `WHERE` clause as the lookup, never a separate check-then-fetch.
 */

const SELECTION = {
  candidateId: supplierCandidates.id,
  externalProductId: supplierCandidates.externalProductId,
  intendedMarketCodes: supplierCandidates.intendedMarketCodes,
  createdAt: supplierCandidates.createdAt,
  evaluation: candidateEvaluations,
  evidence: supplierSnapshots.evidence,
} as const;

export type EvaluatedCandidateRow = {
  candidateId: string;
  externalProductId: string;
  intendedMarketCodes: string[];
  createdAt: Date;
  evaluation: CandidateEvaluationRow;
  /** Null when no CJ evidence has been captured yet (e.g. screening-blocked). */
  evidence: CandidateEvidence | null;
};

function baseQuery() {
  return getDb()
    .select(SELECTION)
    .from(supplierCandidates)
    .innerJoin(
      candidateEvaluations,
      eq(candidateEvaluations.candidateId, supplierCandidates.id),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .leftJoin(
      supplierSnapshots,
      eq(supplierSnapshots.candidateId, supplierCandidates.id),
    );
}

/**
 * `baseQuery()`'s row count, for the same `WHERE` clause. The joins must
 * mirror `baseQuery()` exactly - the search predicate reads the snapshot and
 * feed-snapshot columns, so a missing join would not just change the count,
 * it would fail to compile the same condition. Neither join can inflate the
 * count: `supplier_snapshots` is 1:1 per candidate
 * (`supplier_snapshots_candidate_id_key`) and so is `candidate_evaluations`
 * (`candidate_evaluations_candidate_id_key`).
 */
function countQuery() {
  return getDb()
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
    .leftJoin(
      supplierSnapshots,
      eq(supplierSnapshots.candidateId, supplierCandidates.id),
    );
}

/** One page of a pipeline tab. Rows past `PIPELINE_PAGE_SIZE` are reached by paging, never by one huge response. */
export const PIPELINE_PAGE_SIZE = 100;

/**
 * Hard ceiling on rows in ONE response. Not a ceiling on what a seller can
 * reach: every tab is paged, so a tab holding tens of thousands of rows is
 * fully reachable at `PIPELINE_PAGE_SIZE` per request. Rendering a whole tab
 * in one server-rendered table would be tens of megabytes of HTML.
 */
const MAX_ROWS_PER_REQUEST = 200;

function boundedLimit(limit: number | undefined) {
  return Math.min(
    Math.max(limit ?? PIPELINE_PAGE_SIZE, 1),
    MAX_ROWS_PER_REQUEST,
  );
}

function boundedOffset(offset: number | undefined) {
  return Math.max(offset ?? 0, 0);
}

/** `%` and `_` are LIKE wildcards and `\` escapes them - a seller typing one means the literal character. */
function escapeLikePattern(term: string) {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Case-insensitive substring match, in SQL, over every identifier the search
 * box advertises ("Product name, ID, or SKU"). It must run in the same
 * `WHERE` as the tab's own filter: filtering the already-fetched page in JS
 * instead - the previous behavior - searched only the ~100 rows that page
 * happened to hold, so a hit sitting at row 5,000 of a 86,605-row tab was
 * reported as "No matches".
 *
 * `feed_snapshot->>'name'` is included because it is the only name a
 * screening-blocked candidate has: those rows are decided before any CJ
 * evidence call, so `supplier_snapshots.evidence` is null for every one of
 * them and a name search would otherwise match nothing at all on the
 * Blocked / Rejected tab.
 */
function matchesSearchTerm(term: string): SQL {
  const pattern = `%${escapeLikePattern(term)}%`;

  return sql`(${ilike(supplierCandidates.externalProductId, pattern)}
    OR ${supplierSnapshots.evidence}->>'name' ILIKE ${pattern}
    OR ${supplierSnapshots.evidence}->>'supplierSku' ILIKE ${pattern}
    OR ${candidateEvaluations.feedSnapshot}->>'name' ILIKE ${pattern})`;
}

/**
 * Exported for `queries.pipeline.test.ts`, which serializes it through the
 * Postgres dialect to prove the term travels as a bind parameter (never
 * concatenated into SQL) and that LIKE wildcards inside it are escaped. A
 * Drizzle condition cannot be evaluated without a real database, but its
 * generated SQL and params can be.
 */
export function searchCondition(search: string | undefined): SQL | undefined {
  const term = search?.trim() ?? '';

  return term === '' ? undefined : matchesSearchTerm(term);
}

/**
 * The `WHERE` clause of one pipeline tab, built once and shared by that
 * tab's list and count queries so the table and its page count can never
 * disagree about which rows belong to the tab.
 */
function statusScope(
  sellerAccountId: string,
  statuses: EvaluationStatus[],
  search: string | undefined,
) {
  return and(
    eq(supplierConnections.sellerAccountId, sellerAccountId),
    inArray(candidateEvaluations.status, statuses),
    searchCondition(search),
  );
}

/**
 * Newest decision first, with the row id as a tiebreaker. The tiebreaker is
 * load-bearing for paging, not cosmetic: a policy-version requeue or a
 * discovery cycle stamps thousands of rows with the same `updatedAt`, and
 * ordering by that column alone leaves their relative order undefined - the
 * same row could then appear on two pages while another is skipped entirely.
 */
const PAGE_ORDER = [
  desc(candidateEvaluations.updatedAt),
  asc(candidateEvaluations.id),
] as const;

export type CandidatePageOptions = {
  /** Rows in this response, bounded by `MAX_ROWS_PER_REQUEST`. Defaults to `PIPELINE_PAGE_SIZE`. */
  limit?: number;
  offset?: number;
  /** Matched in SQL against the whole tab - see `matchesSearchTerm`. */
  search?: string;
};

function asEvidence(value: unknown): CandidateEvidence | null {
  return (value as CandidateEvidence | null) ?? null;
}

/**
 * `EVALUATION_FAILED` splits into two buckets by `attemptCount` alone, not
 * status - see `pipeline-bucket.ts#classifyPipelineBucket`, the pure,
 * unit-tested spec these two conditions are hand-transcribed from. Every
 * query below that touches `EVALUATION_FAILED` uses one of these two, never
 * a third hand-rolled variant, so the five pipeline tabs and the count
 * summary can never disagree on where one row belongs.
 */
export function isPreExhaustionFailure() {
  return and(
    eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
    lt(candidateEvaluations.attemptCount, MAX_EVALUATION_ATTEMPTS),
  );
}

export function isExhaustedFailure() {
  return and(
    eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
    gte(candidateEvaluations.attemptCount, MAX_EVALUATION_ATTEMPTS),
  );
}

function evaluatingScope(sellerAccountId: string, search: string | undefined) {
  return and(
    eq(supplierConnections.sellerAccountId, sellerAccountId),
    or(
      eq(candidateEvaluations.status, 'QUEUED'),
      eq(candidateEvaluations.status, 'EVALUATING'),
      isPreExhaustionFailure(),
    ),
    searchCondition(search),
  );
}

function deadLetteredScope(
  sellerAccountId: string,
  search: string | undefined,
) {
  return and(
    eq(supplierConnections.sellerAccountId, sellerAccountId),
    isExhaustedFailure(),
    searchCondition(search),
  );
}

/**
 * Candidates joined with their evaluation (and evidence, when captured),
 * scoped to one seller account and filtered to the given decision statuses
 * - the shared read behind every automated pipeline screen (Ready, Needs
 * Attention, Evaluating, Blocked/Rejected). One page at a time - bounded,
 * never an unbounded scan - with `countCandidatesByStatus` giving the caller
 * the total the page is a window into.
 */
export async function listCandidatesByStatus(
  sellerAccountId: string,
  statuses: EvaluationStatus[],
  options: CandidatePageOptions = {},
): Promise<EvaluatedCandidateRow[]> {
  const rows = await baseQuery()
    .where(statusScope(sellerAccountId, statuses, options.search))
    .orderBy(...PAGE_ORDER)
    .limit(boundedLimit(options.limit))
    .offset(boundedOffset(options.offset));

  return rows.map((row) => ({ ...row, evidence: asEvidence(row.evidence) }));
}

/** Total rows behind `listCandidatesByStatus` - the same scope, unpaged. */
export async function countCandidatesByStatus(
  sellerAccountId: string,
  statuses: EvaluationStatus[],
  search?: string,
): Promise<number> {
  const rows = await countQuery().where(
    statusScope(sellerAccountId, statuses, search),
  );

  return Number(rows[0]?.total ?? 0);
}

/**
 * Candidates still mid-pipeline: `QUEUED`/`EVALUATING`, plus a technical
 * evaluation failure still under its automatic retry cap
 * (`isPreExhaustionFailure`). A row that has exhausted every retry moves to
 * `listDeadLetteredEvaluations` instead - before this function existed,
 * neither query included a mid-retry `EVALUATION_FAILED` row, so it
 * appeared in zero tabs.
 */
export async function listEvaluatingCandidates(
  sellerAccountId: string,
  options: CandidatePageOptions = {},
): Promise<EvaluatedCandidateRow[]> {
  const rows = await baseQuery()
    .where(evaluatingScope(sellerAccountId, options.search))
    .orderBy(...PAGE_ORDER)
    .limit(boundedLimit(options.limit))
    .offset(boundedOffset(options.offset));

  return rows.map((row) => ({ ...row, evidence: asEvidence(row.evidence) }));
}

/** Total rows behind `listEvaluatingCandidates` - the same scope, unpaged. */
export async function countEvaluatingCandidates(
  sellerAccountId: string,
  search?: string,
): Promise<number> {
  const rows = await countQuery().where(
    evaluatingScope(sellerAccountId, search),
  );

  return Number(rows[0]?.total ?? 0);
}

/**
 * Dead-lettered evaluation failures: retries exhausted, genuinely needs a
 * person (spec's Exception Queue - operational failures, never ordinary
 * rejected products). Filters `attemptCount` in SQL rather than fetching
 * every `EVALUATION_FAILED` row and discarding most of them in JS - the
 * previous shape both over-fetched and, combined with `evaluating`'s old
 * query never including this status at all, let a mid-retry row disappear
 * from every tab.
 */
export async function listDeadLetteredEvaluations(
  sellerAccountId: string,
  options: CandidatePageOptions = {},
): Promise<EvaluatedCandidateRow[]> {
  const rows = await baseQuery()
    .where(deadLetteredScope(sellerAccountId, options.search))
    .orderBy(...PAGE_ORDER)
    .limit(boundedLimit(options.limit))
    .offset(boundedOffset(options.offset));

  return rows.map((row) => ({ ...row, evidence: asEvidence(row.evidence) }));
}

/** Total rows behind `listDeadLetteredEvaluations` - the same scope, unpaged. */
export async function countDeadLetteredEvaluations(
  sellerAccountId: string,
  search?: string,
): Promise<number> {
  const rows = await countQuery().where(
    deadLetteredScope(sellerAccountId, search),
  );

  return Number(rows[0]?.total ?? 0);
}

/**
 * Age of the oldest still-`QUEUED` row, in milliseconds - null when nothing
 * is queued. A large value signals a stopped/stale processor (spec's
 * Exception Queue bullet), computed at read time rather than stored.
 */
export async function oldestQueuedAgeMs(
  sellerAccountId: string,
): Promise<number | null> {
  const rows = await getDb()
    .select({ createdAt: candidateEvaluations.createdAt })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        eq(candidateEvaluations.status, 'QUEUED'),
      ),
    )
    .orderBy(asc(candidateEvaluations.createdAt))
    .limit(1);

  return rows[0] === undefined
    ? null
    : Date.now() - rows[0].createdAt.getTime();
}

/**
 * Age of the row that has sat longest in any of the given statuses, in
 * milliseconds - null when none are in that status. Used for a queue's
 * "oldest waiting" column on Overview: `updatedAt` (when a row last entered
 * its current status), not `createdAt`, since a candidate can sit in Ready
 * for months after being created weeks before that.
 */
export async function oldestInStatusAgeMs(
  sellerAccountId: string,
  statuses: EvaluationStatus[],
): Promise<number | null> {
  const rows = await getDb()
    .select({ updatedAt: candidateEvaluations.updatedAt })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        inArray(candidateEvaluations.status, statuses),
      ),
    )
    .orderBy(asc(candidateEvaluations.updatedAt))
    .limit(1);

  return rows[0] === undefined
    ? null
    : Date.now() - rows[0].updatedAt.getTime();
}

/**
 * Same "oldest waiting" shape as `oldestInStatusAgeMs`, scoped to the exact
 * Exception Queue definition (`listDeadLetteredEvaluations`'s own rule):
 * `EVALUATION_FAILED` past every automatic retry, never an ordinary
 * rejection.
 */
export async function oldestExceptionAgeMs(
  sellerAccountId: string,
): Promise<number | null> {
  const rows = await getDb()
    .select({ updatedAt: candidateEvaluations.updatedAt })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        isExhaustedFailure(),
      ),
    )
    .orderBy(asc(candidateEvaluations.updatedAt))
    .limit(1);

  return rows[0] === undefined
    ? null
    : Date.now() - rows[0].updatedAt.getTime();
}

/**
 * Most recent evidence capture for one connection - the real "last
 * successful sync" the Supplier Apps card shows. No connection-level column
 * stores this; it is derived from the same `supplier_snapshots` the
 * evaluation pipeline already writes. `null` means no evidence has ever
 * been captured through this connection - render "Not available", never a
 * fabricated or zero timestamp.
 */
export async function mostRecentSnapshotAt(
  connectionId: string,
): Promise<Date | null> {
  const rows = await getDb()
    .select({ latest: max(supplierSnapshots.capturedAt) })
    .from(supplierSnapshots)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, supplierSnapshots.candidateId),
    )
    .where(eq(supplierCandidates.supplierConnectionId, connectionId));

  return rows[0]?.latest ?? null;
}

export type CandidateStatusCounts = {
  ready: number;
  needsAttention: number;
  evaluating: number;
  evaluatingQueued: number;
  evaluatingProcessing: number;
  blockedRejected: number;
  exceptionQueue: number;
};

/**
 * Lightweight per-seller counts for the nav rail's badges - grouped `COUNT`s,
 * never a full row fetch, since this runs on every portal page render (the
 * shell layout), not a single sourcing screen. Status groupings mirror
 * `queries.ts`'s own list functions exactly (`listCandidatesByStatus`,
 * `listEvaluatingCandidates`, `listDeadLetteredEvaluations`) - and both of
 * the `EVALUATION_FAILED` sub-counts below reuse the identical
 * `isPreExhaustionFailure`/`isExhaustedFailure` predicates those list
 * functions use, rather than a third hand-typed copy - so the badge and the
 * tab it links to can never disagree.
 */
export async function countCandidateStatusSummary(
  sellerAccountId: string,
): Promise<CandidateStatusCounts> {
  const db = getDb();
  const scopedByStatus = db
    .select({ status: candidateEvaluations.status, total: count() })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    // EVALUATION_FAILED is counted separately below - it is the one status
    // that does not map to a single bucket by itself (see
    // `pipeline-bucket.ts`).
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        or(
          eq(candidateEvaluations.status, 'PASS'),
          eq(candidateEvaluations.status, 'PASS_WITH_ATTENTION'),
          eq(candidateEvaluations.status, 'QUEUED'),
          eq(candidateEvaluations.status, 'EVALUATING'),
          eq(candidateEvaluations.status, 'BLOCKED'),
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
        ),
      ),
    )
    .groupBy(candidateEvaluations.status);

  const preExhaustionFailed = db
    .select({ total: count() })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        isPreExhaustionFailure(),
      ),
    );

  const exceptionQueue = db
    .select({ total: count() })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        isExhaustedFailure(),
      ),
    );

  const [statusRows, preExhaustionRows, exceptionRows] = await Promise.all([
    scopedByStatus,
    preExhaustionFailed,
    exceptionQueue,
  ]);

  const totalByStatus = new Map(
    statusRows.map((row) => [row.status, Number(row.total)]),
  );
  const of = (status: EvaluationStatus) => totalByStatus.get(status) ?? 0;

  const evaluatingQueued =
    of('QUEUED') + Number(preExhaustionRows[0]?.total ?? 0);
  const evaluatingProcessing = of('EVALUATING');

  return {
    ready: of('PASS'),
    needsAttention: of('PASS_WITH_ATTENTION'),
    evaluating: evaluatingQueued + evaluatingProcessing,
    evaluatingQueued,
    evaluatingProcessing,
    blockedRejected: of('BLOCKED') + of('TEMPORARILY_INELIGIBLE'),
    exceptionQueue: Number(exceptionRows[0]?.total ?? 0),
  };
}

/**
 * Batched lookup for the raw CJ browser ("All Supplier Products"): given the
 * CJ product ids on one page, returns each one's evaluation (and evidence,
 * when captured) if it has been ingested. A `pid` with no entry has not been
 * picked up by ingestion yet - the caller renders that as "Not yet queued",
 * never a fabricated status.
 */
export async function findEvaluationsByExternalIds(
  sellerAccountId: string,
  externalProductIds: string[],
): Promise<Map<string, EvaluatedCandidateRow>> {
  if (externalProductIds.length === 0) return new Map();

  const rows = await baseQuery().where(
    and(
      eq(supplierConnections.sellerAccountId, sellerAccountId),
      inArray(supplierCandidates.externalProductId, externalProductIds),
    ),
  );

  return new Map(
    rows.map((row) => [
      row.externalProductId,
      { ...row, evidence: asEvidence(row.evidence) },
    ]),
  );
}
