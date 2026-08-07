import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  candidateEvaluations,
  supplierCandidates,
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
 * scoped to one seller and filtered to the given decision statuses - the
 * shared read behind every automated pipeline screen (Ready, Needs
 * Attention, Evaluating, Blocked/Rejected). `limit` is bounded, never an
 * unbounded scan (spec section 17: every read carries seller/tenant scope).
 */
export async function listCandidatesByStatus(
  sellerId: string,
  statuses: EvaluationStatus[],
  limit = 100,
): Promise<EvaluatedCandidateRow[]> {
  const rows = await baseQuery()
    .where(
      and(
        eq(supplierCandidates.intendedSellerId, sellerId),
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
  sellerId: string,
  limit = 100,
): Promise<EvaluatedCandidateRow[]> {
  const rows = await baseQuery()
    .where(
      and(
        eq(supplierCandidates.intendedSellerId, sellerId),
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
  sellerId: string,
): Promise<number | null> {
  const rows = await getDb()
    .select({ createdAt: candidateEvaluations.createdAt })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.intendedSellerId, sellerId),
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
 * Batched lookup for the raw CJ browser ("All Supplier Products"): given the
 * CJ product ids on one page, returns each one's evaluation (and evidence,
 * when captured) if it has been ingested. A `pid` with no entry has not been
 * picked up by ingestion yet - the caller renders that as "Not yet queued",
 * never a fabricated status.
 */
export async function findEvaluationsByExternalIds(
  sellerId: string,
  externalProductIds: string[],
): Promise<Map<string, EvaluatedCandidateRow>> {
  if (externalProductIds.length === 0) return new Map();

  const rows = await baseQuery().where(
    and(
      eq(supplierCandidates.intendedSellerId, sellerId),
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
