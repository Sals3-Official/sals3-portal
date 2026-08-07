import { randomUUID } from 'crypto';
import getDb from '@/lib/db/client';
import type { CandidateEvaluationRow } from '@/lib/db/schema';
import { claimEvaluationBatch } from './repository';
import { EVALUATION_BATCH_SIZE, LEASE_DURATION_MS } from './rules/policy';

/**
 * Claims a batch of evaluable rows for this worker invocation. Must run
 * inside its own transaction (not reused across the batch's later CJ calls)
 * so the `SELECT ... FOR UPDATE SKIP LOCKED` lock is released the moment the
 * claim is made, rather than being held for the ~3.5s per candidate that CJ
 * evidence fetching takes.
 */
export default async function claimBatch(
  batchSize: number = EVALUATION_BATCH_SIZE,
): Promise<CandidateEvaluationRow[]> {
  const workerId = randomUUID();

  return getDb().transaction((tx) =>
    claimEvaluationBatch(tx, {
      workerId,
      batchSize,
      leaseDurationMs: LEASE_DURATION_MS,
    }),
  );
}
