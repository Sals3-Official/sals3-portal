import type { Database } from '@/lib/db/client';
import {
  applyConcurrentIndexes,
  readIndexState,
  type ConcurrentIndexSpec,
  type ConcurrentIndexState,
} from './concurrent-index-migration';

/**
 * The index the sourcing pipeline's own ordering has always needed.
 *
 * ## What is slow, and why
 *
 * `/products/pipeline` pages every tab with
 *
 *     ORDER BY candidate_evaluations.updated_at DESC, id ASC LIMIT 100
 *
 * and `candidate_evaluations` carries indexes on `candidate_id`, `status`,
 * `next_retry_at` and `next_refresh_at` — **none on `updated_at`**. So the Ready
 * tab finds its 432,654 `PASS` rows, **sorts every one of them**, and returns
 * the first hundred. That sort runs on every page load, every tab switch, and
 * every drawer open and close, and it is why the screen sits on its skeletons.
 *
 * A composite on `(status, updated_at DESC, id)` lets Postgres walk the index
 * in the order the page already asks for and stop at the hundredth row. The
 * tiebreaker column is part of the index for the same reason it is part of the
 * `ORDER BY`: without it the sort is not fully resolved and the planner may
 * still need one.
 *
 * ## Honesty about the evidence
 *
 * This is read from the schema — the ordering column has no index — rather than
 * measured with `EXPLAIN` against production, which this workspace has no
 * credential to run. It is the textbook shape for "ORDER BY an unindexed column
 * with a LIMIT over a large table", and the change is additive and reversible:
 * an index that turns out not to be chosen costs write time and disk, and is
 * dropped with one statement. If the screen is still slow afterwards, the next
 * step is a real plan, not a second guessed index.
 *
 * ## Why it is CONCURRENTLY, and why there is no migration file
 *
 * Both for the reasons `concurrent-index-migration.ts` and
 * `migrate-search-trigram.ts` record: `candidate_evaluations` has fourteen write
 * paths that discovery drives continuously, and Drizzle cannot express a
 * `DESC`-ordered composite in the schema, so a hand-written migration would
 * carry no matching snapshot.
 *
 * Unlike the trigram work, **nothing in the application reads this index
 * directly**. It changes how an existing query is planned and nothing else, so
 * there is no ordering hazard between this and any deployment: it is safe
 * before, during and after.
 */
export const PIPELINE_ORDER_INDEXES: readonly ConcurrentIndexSpec[] = [
  {
    name: 'candidate_evaluations_status_updated_idx',
    table: 'candidate_evaluations',
    using: 'btree (status, updated_at DESC, id)',
  },
];

export async function readPipelineOrderIndexState(
  db: Database,
): Promise<ConcurrentIndexState> {
  return readIndexState(db, PIPELINE_ORDER_INDEXES);
}

export type PipelineOrderIndexResult = {
  ok: true;
  before: ConcurrentIndexState;
  after: ConcurrentIndexState;
  droppedInvalid: string[];
  statementsRun: number;
};

export async function migratePipelineOrderIndex(
  db: Database,
): Promise<PipelineOrderIndexResult> {
  const before = await readPipelineOrderIndexState(db);
  const applied = await applyConcurrentIndexes(
    db,
    PIPELINE_ORDER_INDEXES,
    before,
  );

  return {
    ok: true,
    before,
    after: await readPipelineOrderIndexState(db),
    droppedInvalid: applied.droppedInvalid,
    statementsRun: applied.statementsRun,
  };
}
