// @vitest-environment node
//
// The module imports `@/lib/db/client` for its `Database` type, and that file
// throws when `window` is defined.
import { describe, expect, it, vi } from 'vitest';
import {
  migratePipelineOrderIndex,
  PIPELINE_ORDER_INDEXES,
  readPipelineOrderIndexState,
} from './migrate-pipeline-order-index';

type Row = Record<string, unknown>;

function stubDb(responses: Row[][]) {
  const issued: string[] = [];
  let call = 0;

  const db = {
    execute: vi.fn(async (query: unknown) => {
      issued.push(JSON.stringify(query));
      call += 1;

      return responses[call - 1] ?? [];
    }),
  };

  return { db, issued, raw: () => issued.join('\n') };
}

const INDEX = PIPELINE_ORDER_INDEXES[0].name;

describe('PIPELINE_ORDER_INDEXES', () => {
  it('covers the columns the pipeline actually orders by', () => {
    // `PAGE_ORDER` in queries.ts is `updated_at DESC, id ASC`, filtered by
    // status. All three belong in the index or the planner still needs a sort:
    // the tiebreaker is load-bearing for paging, not cosmetic.
    expect(PIPELINE_ORDER_INDEXES[0].using).toBe(
      'btree (status, updated_at DESC, id)',
    );
    expect(PIPELINE_ORDER_INDEXES[0].table).toBe('candidate_evaluations');
  });
});

describe('readPipelineOrderIndexState', () => {
  it('is ready only when the index exists and is valid', async () => {
    const { db } = stubDb([[{ name: INDEX, valid: true }]]);

    expect((await readPipelineOrderIndexState(db as never)).ready).toBe(true);
  });

  it('is not ready when the index exists but is INVALID', async () => {
    // The case a naive re-run would lie about: `IF NOT EXISTS` sees the name
    // and does nothing while the planner ignores the index.
    const { db } = stubDb([[{ name: INDEX, valid: false }]]);
    const state = await readPipelineOrderIndexState(db as never);

    expect(state.indexes[0]).toEqual({
      name: INDEX,
      exists: true,
      valid: false,
    });
    expect(state.ready).toBe(false);
  });

  it('is not ready when the index is absent', async () => {
    const { db } = stubDb([[]]);

    expect((await readPipelineOrderIndexState(db as never)).ready).toBe(false);
  });
});

describe('migratePipelineOrderIndex', () => {
  it('builds CONCURRENTLY, never with a plain CREATE INDEX', async () => {
    // `candidate_evaluations` has fourteen write paths driven continuously by
    // discovery; a plain build would hold a lock for the whole of it.
    const { db, raw } = stubDb([[]]);

    await migratePipelineOrderIndex(db as never);

    expect(raw()).toContain(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX}`);
    expect(raw()).not.toMatch(/CREATE INDEX (?!CONCURRENTLY)/);
  });

  it('clears statement_timeout before building', async () => {
    const { db, raw } = stubDb([[]]);

    await migratePipelineOrderIndex(db as never);

    expect(raw()).toContain('SET statement_timeout = 0');
  });

  it('drops an INVALID index before rebuilding it', async () => {
    const { db, issued, raw } = stubDb([[{ name: INDEX, valid: false }]]);
    const result = await migratePipelineOrderIndex(db as never);

    expect(result.droppedInvalid).toEqual([INDEX]);

    const dropAt = issued.findIndex((s) => s.includes('DROP INDEX'));
    const createAt = issued.findIndex((s) => s.includes('CREATE INDEX'));

    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
    expect(raw()).toContain(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX}`);
  });

  it('leaves a valid index alone rather than rebuilding it', async () => {
    const { db, raw } = stubDb([[{ name: INDEX, valid: true }]]);
    const result = await migratePipelineOrderIndex(db as never);

    expect(result.statementsRun).toBe(0);
    expect(raw()).not.toContain('CREATE INDEX');
    expect(raw()).not.toContain('DROP INDEX');
  });
});
