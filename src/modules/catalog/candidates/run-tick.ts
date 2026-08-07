import getDb from '@/lib/db/client';
import evaluateCandidate from './evaluate';
import ingestCjFeed, { type IngestionResult } from './ingestion';
import claimBatch from './lease';
import { requeueDueRetries } from './repository';
import { EVALUATION_BATCH_SIZE } from './rules/policy';

/**
 * One cron tick's worth of work (spec's automated pipeline, entry point for
 * `src/app/api/internal/catalog/evaluate-tick/route.ts`):
 *
 * 1. Ingest the CJ feed (new/changed candidates -> `QUEUED`).
 * 2. Requeue any `TEMPORARILY_INELIGIBLE`/`EVALUATION_FAILED` row whose
 *    backoff has elapsed.
 * 3. Claim and evaluate one bounded batch, sequentially - CJ allows one
 *    request per second, so running a batch concurrently would only trip the
 *    rate limit, not finish faster.
 */

export type TickResult = {
  ingestion: IngestionResult;
  requeuedForRetry: number;
  claimed: number;
  evaluated: number;
};

export default async function runEvaluationTick(): Promise<TickResult> {
  const ingestion = await ingestCjFeed();
  const requeuedForRetry = await requeueDueRetries(
    getDb(),
    EVALUATION_BATCH_SIZE,
  );
  const batch = await claimBatch(EVALUATION_BATCH_SIZE);

  let evaluated = 0;

  // eslint-disable-next-line no-restricted-syntax -- CJ's 1 req/sec limit makes this sequential by necessity.
  for (const row of batch) {
    // eslint-disable-next-line no-await-in-loop -- see above.
    await evaluateCandidate(row);
    evaluated += 1;
  }

  return { ingestion, requeuedForRetry, claimed: batch.length, evaluated };
}
