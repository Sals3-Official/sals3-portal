import { and, asc, count, desc, eq, gte, inArray, max } from 'drizzle-orm';
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

function asEvidence(value: unknown): CandidateEvidence | null {
  return (value as CandidateEvidence | null) ?? null;
}

/**
 * Candidates joined with their evaluation (and evidence, when captured),
 * scoped to one seller account and filtered to the given decision statuses
 * - the shared read behind every automated pipeline screen (Ready, Needs
 * Attention, Evaluating, Blocked/Rejected). `limit` is bounded, never an
 * unbounded scan.
 */
export async function listCandidatesByStatus(
  sellerAccountId: string,
  statuses: EvaluationStatus[],
  limit = 100,
): Promise<EvaluatedCandidateRow[]> {
  const rows = await baseQuery()
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        inArray(candidateEvaluations.status, statuses),
      ),
    )
    .orderBy(desc(candidateEvaluations.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => ({ ...row, evidence: asEvidence(row.evidence) }));
}

/**
 * Dead-lettered evaluation failures: retries exhausted, genuinely needs a
 * person (spec's Exception Queue - operational failures, never ordinary
 * rejected products).
 */
export async function listDeadLetteredEvaluations(
  sellerAccountId: string,
  limit = 100,
): Promise<EvaluatedCandidateRow[]> {
  const rows = await baseQuery()
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
      ),
    )
    .orderBy(desc(candidateEvaluations.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows
    .filter((row) => row.evaluation.attemptCount >= MAX_EVALUATION_ATTEMPTS)
    .map((row) => ({ ...row, evidence: asEvidence(row.evidence) }));
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
        eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        gte(candidateEvaluations.attemptCount, MAX_EVALUATION_ATTEMPTS),
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
  blockedRejected: number;
  exceptionQueue: number;
};

/**
 * Lightweight per-seller counts for the nav rail's badges - grouped `COUNT`s,
 * never a full row fetch, since this runs on every portal page render (the
 * shell layout), not a single sourcing screen. Status groupings mirror each
 * status page's own query exactly (`evaluating/page.tsx`, `blocked/page.tsx`,
 * `exception-queue/page.tsx`) so the badge and the page it links to can never
 * disagree.
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
    .where(eq(supplierConnections.sellerAccountId, sellerAccountId))
    .groupBy(candidateEvaluations.status);

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
        eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        gte(candidateEvaluations.attemptCount, MAX_EVALUATION_ATTEMPTS),
      ),
    );

  const [statusRows, exceptionRows] = await Promise.all([
    scopedByStatus,
    exceptionQueue,
  ]);

  const totalByStatus = new Map(
    statusRows.map((row) => [row.status, Number(row.total)]),
  );
  const of = (status: EvaluationStatus) => totalByStatus.get(status) ?? 0;

  return {
    ready: of('PASS'),
    needsAttention: of('PASS_WITH_ATTENTION'),
    evaluating: of('QUEUED') + of('EVALUATING'),
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
