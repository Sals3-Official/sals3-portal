import getDb from '@/lib/db/client';
import createGovernedFetch from '../discovery/governed-fetch';
import dispatchOutbox from '../discovery/outbox-dispatch';
import evaluateCandidate from './evaluate';
import claimBatch from './lease';
import { findCandidateById, requeueDueRetries } from './repository';
import { EVALUATION_BATCH_SIZE } from './rules/policy';

/**
 * BREAK-GLASS RECOVERY ONLY (ADR-013 §12). The normal execution model is
 * the durable Vercel Queues chain (`src/modules/catalog/discovery/`), which
 * needs no scheduler at all. This tick exists solely as an authenticated
 * manual recovery action for a stalled chain:
 *
 * 1. Drain the transactional outbox (re-publishes any successor intent a
 *    crashed worker committed but never published).
 * 2. Requeue evaluations whose retry backoff elapsed while their delayed
 *    retry message was lost.
 * 3. Claim and evaluate one bounded batch.
 *
 * It must NOT be scheduled - the GitHub Actions cron that used to call it
 * every five minutes is removed; only manual `workflow_dispatch` (or a
 * direct authenticated call) remains. It performs no full-feed paging: all
 * discovery goes through the partition-driven queue chain.
 */

export type TickResult = {
  outbox: { dispatched: number; failed: number };
  requeuedForRetry: number;
  claimed: number;
  evaluated: number;
};

export default async function runEvaluationTick(): Promise<TickResult> {
  const outbox = await dispatchOutbox();
  const requeuedForRetry = await requeueDueRetries(
    getDb(),
    EVALUATION_BATCH_SIZE,
  );
  const batch = await claimBatch(EVALUATION_BATCH_SIZE);

  let evaluated = 0;

  // eslint-disable-next-line no-restricted-syntax -- CJ's 1 req/sec limit makes this sequential by necessity.
  for (const row of batch) {
    // Every supplier call goes through the governed fetch, exactly as the
    // queue handler does. Without it this route would spend CJ points
    // outside the shared limiter AND never persist the `pointsInfo` the
    // responses carry - leaving `supplier_request_budgets` stale, so the
    // points gate that every concurrent queue worker consults would read a
    // budget that no longer reflects reality.
    // eslint-disable-next-line no-await-in-loop -- see above.
    const candidate = await findCandidateById(getDb(), row.candidateId);

    // eslint-disable-next-line no-await-in-loop -- see above.
    await evaluateCandidate(row, {
      fetchImpl:
        candidate === null
          ? undefined
          : createGovernedFetch(candidate.supplierConnectionId),
    });
    evaluated += 1;
  }

  return { outbox, requeuedForRetry, claimed: batch.length, evaluated };
}
