import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * One-time DDL giving the sourcing search real typo tolerance: the `pg_trgm`
 * extension plus a GIN trigram index on each field the pipeline search reads
 * out of `candidate_evaluations.feed_snapshot`.
 *
 * ## Why the search needs it
 *
 * Substring matching cannot find a misspelling: `pnats` appears nowhere inside
 * `Pants`. Trigram similarity can, because both strings share the trigrams
 * `pan`/`ant`/`nts` in some order. Without an index that comparison is a
 * sequential scan over 588,850 rows on every keystroke-driven request, which is
 * slower than the substring search it replaces — so the index is not an
 * optimisation here, it is the entry requirement.
 *
 * ## Why CONCURRENTLY, and why that forces a different runner shape
 *
 * `candidate_evaluations` has **fourteen write paths** and discovery writes to
 * it continuously. A plain `CREATE INDEX` takes a `SHARE` lock for the whole
 * build, which on a GIN trigram index over half a million jsonb-extracted texts
 * means minutes of stalled discovery. `CREATE INDEX CONCURRENTLY` does not
 * block writes.
 *
 * The cost is that **`CONCURRENTLY` cannot run inside a transaction block**, so
 * this module deliberately does NOT follow `migrate-opex-floor.ts` and
 * `migrate-optional-base-markup.ts`, which wrap their statements in one
 * transaction with a `lock_timeout`. Each statement here runs on its own. That
 * is a real difference in blast radius and it is the reason for the recovery
 * step below rather than an oversight.
 *
 * ## Why a failed run is safe, and self-healing
 *
 * A `CONCURRENTLY` build that loses its connection — a serverless invocation
 * cut at `maxDuration`, a network blip — leaves behind an **invalid** index:
 * present in `pg_class`, ignored by the planner, and still costing writes.
 * Postgres will not replace it silently, and `IF NOT EXISTS` sees the name and
 * does nothing, so a naive re-run would report success forever while the index
 * stayed dead.
 *
 * So every run reads `pg_index.indisvalid` first and **drops an invalid index
 * before rebuilding it**. That makes the whole operation re-runnable: call it
 * again after any failure and it converges. The workflow calls it until the
 * state reports every index valid.
 *
 * ## Why there is no migration file
 *
 * Drizzle cannot express a GIN index on a jsonb *expression* in the schema, so
 * `drizzle-kit generate` would never produce this and a hand-written migration
 * would carry no matching snapshot — the trap that has bitten this repository
 * before. `db:migrate` is also local-only by design (`guard-remote-db.mts`),
 * and production DDL has always arrived through this break-glass path.
 *
 * The consequence is stated rather than hidden: **a database that has not had
 * this run has no `pg_trgm`**, including a fresh local one and CI. The search
 * that uses it must therefore detect the extension and fall back, never assume
 * it — a query calling `similarity()` without the extension does not run slowly,
 * it errors.
 */

/** The two indexes this creates, and the expression each one covers. */
export const TRIGRAM_INDEXES = [
  {
    name: 'candidate_evaluations_feed_name_trgm_idx',
    expression: "(feed_snapshot ->> 'name')",
  },
  {
    name: 'candidate_evaluations_feed_sku_trgm_idx',
    expression: "(feed_snapshot ->> 'sku')",
  },
] as const;

export type TrigramIndexState = {
  name: string;
  exists: boolean;
  /** `false` for an index a previous interrupted build left behind. */
  valid: boolean;
};

export type SearchTrigramState = {
  extensionInstalled: boolean;
  indexes: TrigramIndexState[];
  /** True only when the extension is present and every index is valid. */
  ready: boolean;
};

function createIndexStatement(index: (typeof TRIGRAM_INDEXES)[number]): string {
  return `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${index.name} ON candidate_evaluations USING gin (${index.expression} gin_trgm_ops)`;
}

function dropIndexStatement(name: string): string {
  return `DROP INDEX CONCURRENTLY IF EXISTS ${name}`;
}

/**
 * Reads the live state without writing anything, so a run can be confirmed
 * before and after rather than inferred from a green workflow.
 */
export async function readSearchTrigramState(
  db: Database,
): Promise<SearchTrigramState> {
  const extensionRows = (await db.execute(
    sql`SELECT 1 AS present FROM pg_extension WHERE extname = 'pg_trgm'`,
  )) as unknown as Array<{ present: number }>;

  const indexRows = (await db.execute(
    sql`SELECT c.relname AS name, i.indisvalid AS valid
        FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE c.relname IN (${sql.join(
          TRIGRAM_INDEXES.map((index) => sql`${index.name}`),
          sql`, `,
        )})`,
  )) as unknown as Array<{ name: string; valid: boolean }>;

  const byName = new Map(indexRows.map((row) => [row.name, row.valid]));
  const indexes = TRIGRAM_INDEXES.map((index) => ({
    name: index.name,
    exists: byName.has(index.name),
    valid: byName.get(index.name) === true,
  }));

  const extensionInstalled = extensionRows.length > 0;

  return {
    extensionInstalled,
    indexes,
    ready: extensionInstalled && indexes.every((index) => index.valid),
  };
}

export type SearchTrigramMigrationResult = {
  ok: true;
  before: SearchTrigramState;
  after: SearchTrigramState;
  /** Names of invalid indexes an earlier interrupted run left behind. */
  droppedInvalid: string[];
  statementsRun: number;
};

/**
 * Applies the DDL, dropping any invalid leftover first.
 *
 * Statements run one at a time and OUTSIDE a transaction, which `CONCURRENTLY`
 * requires. `statement_timeout` is cleared for the session first: a build over
 * half a million rows can legitimately outlast a conservative default, and
 * being killed by a timeout is precisely what leaves an invalid index behind.
 */
export async function migrateSearchTrigram(
  db: Database,
): Promise<SearchTrigramMigrationResult> {
  const before = await readSearchTrigramState(db);
  const droppedInvalid: string[] = [];
  let statementsRun = 0;

  await db.execute(sql.raw('SET statement_timeout = 0'));

  if (!before.extensionInstalled) {
    await db.execute(sql.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm'));
    statementsRun += 1;
  }

  // eslint-disable-next-line no-restricted-syntax -- a fixed, ordered list run one statement at a time; CONCURRENTLY forbids a transaction.
  for (const index of TRIGRAM_INDEXES) {
    const state = before.indexes.find((row) => row.name === index.name);

    // An index that exists but is INVALID is worse than an absent one: the
    // planner ignores it while every write still maintains it, and
    // `IF NOT EXISTS` would leave it in place forever.
    if (state?.exists === true && state.valid === false) {
      // eslint-disable-next-line no-await-in-loop -- sequential by necessity
      await db.execute(sql.raw(dropIndexStatement(index.name)));
      droppedInvalid.push(index.name);
      statementsRun += 1;
    }

    if (state?.valid !== true) {
      // eslint-disable-next-line no-await-in-loop -- sequential by necessity
      await db.execute(sql.raw(createIndexStatement(index)));
      statementsRun += 1;
    }
  }

  return {
    ok: true,
    before,
    after: await readSearchTrigramState(db),
    droppedInvalid,
    statementsRun,
  };
}
