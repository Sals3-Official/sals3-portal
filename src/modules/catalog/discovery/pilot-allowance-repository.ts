import { isNotNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import { candidateEvaluations } from '@/lib/db/schema';
import { PILOT_BASELINE_COUNT, PILOT_EVIDENCE_CAP } from './config';

/**
 * Development-pilot evidence allowance (see `config.ts#PILOT_EVIDENCE_CAP`).
 * Counts how many candidates have ever COMPLETED a paid CJ evidence fetch,
 * and refuses further paid work once the owner's total is reached.
 *
 * The tally is `evidence_summary IS NOT NULL`, which is exact for this
 * purpose and needs no new table, column, or migration:
 *
 * - It is written at exactly ONE site, `recordEvaluationDecision`, and only
 *   after `getCandidateEvidence` returned. A screening-only decision goes
 *   through `recordScreeningDecision`, which never touches the column - so a
 *   free block can never consume allowance.
 * - Nothing ever clears it. Neither requeue path (`requeueDueRefreshes`,
 *   `requeuePolicyVersionMismatches`, `requeueForSourceChange`,
 *   `requeueIfFingerprintChanged`, `requeueForManualRecheck`), nor
 *   `releaseEvaluationClaim`, `recordEvaluationFailure`, or the claim itself
 *   includes it in their `.set()`, and no code path deletes an evaluation
 *   row. The count is therefore monotonic, which is what makes a total cap
 *   meaningful.
 *
 * Two known imprecisions, both accepted deliberately:
 *
 * 1. A fetch that spends points and THEN fails leaves the column null, so
 *    those points are invisible here. The data-level market gate bounds the
 *    exposure regardless.
 * 2. A later freshness re-fetch of an already-counted product overwrites the
 *    same row, so it does not consume allowance a second time. The cap
 *    counts DISTINCT PRODUCTS admitted to the paid pool, not total fetches.
 *
 * No index is added. This is a sequential count over the evaluations table
 * on the paid path only - which the cap itself bounds - and a partial index
 * would require a migration, which production applies by hand.
 */

/** How many candidates have ever completed a paid evidence fetch. */
export async function countPaidEvaluations(
  executor: DbExecutor,
): Promise<number> {
  const rows = await executor
    .select({ total: sql<number>`count(*)` })
    .from(candidateEvaluations)
    .where(isNotNull(candidateEvaluations.evidenceSummary));

  return Number(rows[0]?.total ?? 0);
}

export type PilotAllowance = {
  exhausted: boolean;
  paidCount: number;
  limit: number;
};

/**
 * Read-only. Callers must treat `exhausted` as a refusal to spend, never as
 * a reservation: the count-then-fetch window is not atomic, so concurrent
 * workers can overshoot by at most the number in flight. Configure the cap
 * below the owner's true ceiling to absorb that.
 */
export async function assessPilotAllowance(
  executor: DbExecutor,
): Promise<PilotAllowance> {
  const paidCount = await countPaidEvaluations(executor);
  const limit = PILOT_BASELINE_COUNT + PILOT_EVIDENCE_CAP;

  return { exhausted: paidCount >= limit, paidCount, limit };
}
