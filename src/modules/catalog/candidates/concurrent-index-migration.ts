import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * The shared runner for break-glass indexes built `CONCURRENTLY`.
 *
 * Extracted from `migrate-search-trigram.ts` when a second index needed the
 * same treatment. Everything subtle here was learned once and must not be
 * learned twice:
 *
 * - **`CONCURRENTLY` cannot run inside a transaction**, so this deliberately
 *   does not use the transaction-wrapped shape the pricing migrations use.
 *   Each statement runs on its own.
 * - **An interrupted build leaves an INVALID index** — present in `pg_class`,
 *   ignored by the planner, still maintained by every write. `IF NOT EXISTS`
 *   sees the name and does nothing, so a naive re-run would report success
 *   forever while the index stayed dead. Every run therefore reads
 *   `pg_index.indisvalid` and drops an invalid index before rebuilding.
 * - **`statement_timeout` is cleared first**, because being killed by a timeout
 *   is exactly what leaves an invalid index behind.
 *
 * The result is re-runnable: call it again after any failure and it converges.
 */

export type ConcurrentIndexSpec = {
  name: string;
  /** The table the index is created on. */
  table: string;
  /** Everything inside `USING ...` — the method and the indexed expression. */
  using: string;
};

export type IndexState = {
  name: string;
  exists: boolean;
  /** `false` for an index a previous interrupted build left behind. */
  valid: boolean;
};

export type ConcurrentIndexState = {
  indexes: IndexState[];
  /** True only when every index is present and valid. */
  ready: boolean;
};

export function createIndexStatement(spec: ConcurrentIndexSpec): string {
  return `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${spec.name} ON ${spec.table} USING ${spec.using}`;
}

export function dropIndexStatement(name: string): string {
  return `DROP INDEX CONCURRENTLY IF EXISTS ${name}`;
}

/** Reads the live state of the named indexes without writing anything. */
export async function readIndexState(
  db: Database,
  specs: readonly ConcurrentIndexSpec[],
): Promise<ConcurrentIndexState> {
  const rows = (await db.execute(
    sql`SELECT c.relname AS name, i.indisvalid AS valid
        FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname IN (${sql.join(
          specs.map((spec) => sql`${spec.name}`),
          sql`, `,
        )})`,
  )) as unknown as Array<{ name: string; valid: boolean }>;

  const byName = new Map(rows.map((row) => [row.name, row.valid]));
  const indexes = specs.map((spec) => ({
    name: spec.name,
    exists: byName.has(spec.name),
    valid: byName.get(spec.name) === true,
  }));

  return { indexes, ready: indexes.every((index) => index.valid) };
}

export type ConcurrentIndexResult = {
  before: ConcurrentIndexState;
  /** Names of invalid indexes an earlier interrupted run left behind. */
  droppedInvalid: string[];
  statementsRun: number;
};

/**
 * Builds every missing index, dropping an invalid leftover first.
 *
 * Takes the state it should act on rather than reading it again, so a caller
 * that has already read a wider state (an extension, say) reports one
 * consistent `before` rather than two snapshots taken moments apart.
 */
export async function applyConcurrentIndexes(
  db: Database,
  specs: readonly ConcurrentIndexSpec[],
  before: ConcurrentIndexState,
): Promise<ConcurrentIndexResult> {
  const droppedInvalid: string[] = [];
  let statementsRun = 0;

  await db.execute(sql.raw('SET statement_timeout = 0'));

  // eslint-disable-next-line no-restricted-syntax -- a fixed, ordered list run one statement at a time; CONCURRENTLY forbids a transaction.
  for (const spec of specs) {
    const state = before.indexes.find((row) => row.name === spec.name);

    if (state?.exists === true && state.valid === false) {
      // eslint-disable-next-line no-await-in-loop -- sequential by necessity
      await db.execute(sql.raw(dropIndexStatement(spec.name)));
      droppedInvalid.push(spec.name);
      statementsRun += 1;
    }

    if (state?.valid !== true) {
      // eslint-disable-next-line no-await-in-loop -- sequential by necessity
      await db.execute(sql.raw(createIndexStatement(spec)));
      statementsRun += 1;
    }
  }

  return { before, droppedInvalid, statementsRun };
}
