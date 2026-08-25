import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * One-time, idempotent DDL giving merchant pricing a destination scope
 * (`pricing_category_policies.market_code`,
 * `pricing_store_defaults.market_code`).
 *
 * ## What it is for
 *
 * ADR-015's `Amendment — 2026-08-25`, owner decision: operational expense is
 * not the same number in every country, so one commercial rule cannot be right
 * in more than one of them. On the 2026-08-24 freight measurements a single
 * 300 g basket costs `$3.70` to the Philippines and `$16.01` to Fiji, while a
 * 25% margin on a `$4.29` supplier cost contributes about `$1.07` and covers
 * neither.
 *
 * **`null` is the unscoped rule, not a missing value.** Every policy that
 * exists today keeps its exact current meaning the moment the column lands, and
 * no backfill is required to preserve behaviour — which is the whole reason the
 * column is nullable rather than `NOT NULL DEFAULT 'AU'`.
 *
 * The floor travels with the margin. The owner's justification was operational
 * expense, and `min_contribution_minor` is the instrument that carries exactly
 * that — the cost that does not shrink when an item is cheap. Scoping the
 * margin without scoping the floor would have moved half the rule.
 *
 * ## Why this ships with no Drizzle schema change
 *
 * Same rule `migrate-media-stored-copy.ts` records, for the same reason:
 * **Drizzle names every column of the schema in an `INSERT`**, filling omitted
 * ones with `default`. Adding `marketCode` to `schema/pricing-policy.ts` is by
 * itself enough to make every policy write emit
 * `insert into pricing_category_policies (..., "market_code", ...)` and fail
 * against a database that does not have it — which would break the Market Rules
 * screen's every save, not one page.
 *
 * The columns therefore enter the Drizzle tables in the change that also reads
 * them, deployed only after a run here reports `columnsExistAfter: true`. The
 * `drizzle/` migration file and its `__drizzle_migrations` bookkeeping travel
 * with that change, because a ledger row pointing at a file that does not exist
 * yet is worse than no row.
 */

/**
 * ## The unique indexes are the point, not the columns
 *
 * `pricing_category_policies_active_key` guarantees at most one `ACTIVE` policy
 * per seller+category, and the resolver depends on it having exactly one row to
 * choose. Simply adding `market_code` to that index would have **silently
 * destroyed** the guarantee: Postgres treats `NULL`s as distinct in a unique
 * index, so two `ACTIVE` all-destinations policies for one category would both
 * have been accepted.
 *
 * So each table gets **two** partial indexes, split on `market_code IS NULL`.
 * The all-markets index is exactly the old one plus that predicate, which is why
 * it can be created against existing rows without any of them colliding: every
 * row that exists when this runs has `market_code IS NULL`.
 *
 * ## Every statement is idempotent without an exception handler
 *
 * `ADD CONSTRAINT` has no `IF NOT EXISTS` form, and the recorded lesson is that
 * a `catch` inside one shared transaction is useless — the first already-existing
 * object aborts the transaction and every later statement fails on a poisoned
 * connection. `DROP CONSTRAINT IF EXISTS` immediately before `ADD CONSTRAINT`
 * sidesteps that entirely: no handler, no per-statement transaction, and the
 * whole run stays atomic.
 *
 * Order matters. The old index is dropped before the new ones are created, and
 * all of it is one transaction — so a failure anywhere leaves the table with its
 * original index rather than with none.
 */
export const PER_MARKET_SCOPE_DDL_STATEMENTS = [
  'ALTER TABLE "pricing_category_policies" ADD COLUMN IF NOT EXISTS "market_code" text',
  'ALTER TABLE "pricing_store_defaults" ADD COLUMN IF NOT EXISTS "market_code" text',

  'DROP INDEX IF EXISTS "pricing_category_policies_active_key"',
  `CREATE UNIQUE INDEX IF NOT EXISTS "pricing_category_policies_active_all_markets_key"
     ON "pricing_category_policies" ("seller_account_id", "category_id")
     WHERE "status" = 'ACTIVE' AND "market_code" IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "pricing_category_policies_active_market_key"
     ON "pricing_category_policies" ("seller_account_id", "category_id", "market_code")
     WHERE "status" = 'ACTIVE' AND "market_code" IS NOT NULL`,

  'DROP INDEX IF EXISTS "pricing_store_defaults_active_key"',
  `CREATE UNIQUE INDEX IF NOT EXISTS "pricing_store_defaults_active_all_markets_key"
     ON "pricing_store_defaults" ("seller_account_id")
     WHERE "status" = 'ACTIVE' AND "market_code" IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "pricing_store_defaults_active_market_key"
     ON "pricing_store_defaults" ("seller_account_id", "market_code")
     WHERE "status" = 'ACTIVE' AND "market_code" IS NOT NULL`,

  // Same shape `product_offers_market_code_shape` already enforces. A CHECK
  // passes on NULL, so the unscoped rule is admitted without a second clause
  // saying so.
  'ALTER TABLE "pricing_category_policies" DROP CONSTRAINT IF EXISTS "pricing_category_policies_market_code_shape"',
  `ALTER TABLE "pricing_category_policies" ADD CONSTRAINT "pricing_category_policies_market_code_shape"
     CHECK ("market_code" IS NULL OR "market_code" ~ '^[A-Z]{2}$')`,
  'ALTER TABLE "pricing_store_defaults" DROP CONSTRAINT IF EXISTS "pricing_store_defaults_market_code_shape"',
  `ALTER TABLE "pricing_store_defaults" ADD CONSTRAINT "pricing_store_defaults_market_code_shape"
     CHECK ("market_code" IS NULL OR "market_code" ~ '^[A-Z]{2}$')`,
] as const;

/**
 * The real hazard is the lock, not the columns. `ALTER TABLE` takes an
 * `ACCESS EXCLUSIVE` lock; if a long query holds either table, the ALTER queues
 * and every pricing read and policy write queues behind it. Failing fast is the
 * rollback story for a DDL that otherwise has none: the statement aborts, the
 * transaction rolls back, nothing changed, and the run can be retried at a
 * quieter moment.
 *
 * `SET LOCAL` rather than a session `SET`: this runs on a pooled serverless
 * connection, and a session-level timeout would leak onto whatever unrelated
 * query reuses that connection next.
 */
export const DDL_LOCK_TIMEOUT = '5s';

const SCOPED_TABLES = ['pricing_category_policies', 'pricing_store_defaults'];

/**
 * Read-only. Whether both columns are actually present, asked of the database
 * rather than inferred from a migration ledger — the ledger records intent, this
 * records reality, and the 2026-08-18 incident is what happens when those two
 * disagree.
 */
export async function hasPerMarketScopeColumns(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT table_name FROM information_schema.columns
       WHERE table_name IN ('${SCOPED_TABLES.join("', '")}')
         AND column_name = 'market_code'`,
    ),
  )) as unknown as unknown[];

  return rows.length === SCOPED_TABLES.length;
}

/**
 * Read-only. Whether the four scope-aware unique indexes exist.
 *
 * Reported separately from the columns because they fail differently and
 * matter differently: a missing column breaks every write immediately and
 * loudly, while a missing index breaks nothing until two rows collide — and by
 * then the resolver has already had two candidates to choose between and picked
 * one arbitrarily. The column check alone would have called that success.
 */
export async function hasPerMarketScopeIndexes(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN (
         'pricing_category_policies_active_all_markets_key',
         'pricing_category_policies_active_market_key',
         'pricing_store_defaults_active_all_markets_key',
         'pricing_store_defaults_active_market_key'
       )`,
    ),
  )) as unknown as unknown[];

  return rows.length === 4;
}

export type RunPerMarketScopeDdlResult = { statementsRun: number };

export async function runPerMarketScopeDdl(
  db: Database,
): Promise<RunPerMarketScopeDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));

    // eslint-disable-next-line no-restricted-syntax -- a fixed, ordered list in one transaction; the order is the point.
    for (const statement of PER_MARKET_SCOPE_DDL_STATEMENTS) {
      // eslint-disable-next-line no-await-in-loop
      await tx.execute(sql.raw(statement));
    }
  });

  return { statementsRun: PER_MARKET_SCOPE_DDL_STATEMENTS.length };
}

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0029_jazzy_senator_kelly`
 * (`when`) and the sha256 of `drizzle/0029_jazzy_senator_kelly.sql`'s raw file
 * content, computed the way `drizzle-orm`'s own `readMigrationFiles()` does it.
 * Hard-coded so this endpoint never depends on the migration file being in the
 * deployed bundle. Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0029_jazzy_senator_kelly.sql').toString()).digest('hex'))"
 * only if the migration is regenerated. Pinned to the file by its own test.
 */
const MIGRATION_0029_CREATED_AT = 1787659573173;
const MIGRATION_0029_HASH =
  'cb2fbb5fce65fe857db70d7c7a9ccfb0d0ac106274dd934862a4ace244e55637';

export type MarkMigration0029AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records `0029_jazzy_senator_kelly` as applied, so a later real
 * `npm run db:migrate` does not try to run it again.
 *
 * The DDL above already reached production through the break-glass endpoint
 * **before** this migration file existed — that ordering is the whole point of
 * the two-step. Without this row the ledger and the database disagree: the
 * columns are there and drizzle believes they are not.
 *
 * Idempotent by construction; the values are fixed constants, not request
 * input, so the raw SQL carries no injection risk.
 */
export async function markMigration0029Applied(
  db: Database,
): Promise<MarkMigration0029AppliedResult> {
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "drizzle"`));
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )`,
    ),
  );

  const existing = (await db.execute(
    sql.raw(
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0029_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0029_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0029_HASH}', ${MIGRATION_0029_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0029_CREATED_AT, inserted: true };
}

export const MIGRATION_0029 = {
  tag: '0029_jazzy_senator_kelly',
  createdAt: MIGRATION_0029_CREATED_AT,
  hash: MIGRATION_0029_HASH,
} as const;

export type MigratePerMarketScopeResult = {
  ok: true;
  columnsExistedBefore: boolean;
  indexesExistedBefore: boolean;
  ddl: RunPerMarketScopeDdlResult;
  migrationRecord: MarkMigration0029AppliedResult;
  columnsExistAfter: boolean;
  indexesExistAfter: boolean;
};

/**
 * The whole run, with its own before/after readings.
 *
 * `markMigration0029Applied` runs here too, and it arrived in the change that
 * added the migration file rather than in the one that first ran this DDL —
 * a ledger row pointing at a file that is not in the bundle yet is worse than
 * no row. Re-running the workflow after that change is what writes it; the DDL
 * half no-ops.
 *
 * Both `*After` flags are reported because they fail differently: a missing
 * column breaks every write immediately, a missing index breaks nothing until
 * two rows collide and the resolver silently picks one of them.
 */
export async function migratePerMarketScope(
  db: Database,
): Promise<MigratePerMarketScopeResult> {
  const columnsExistedBefore = await hasPerMarketScopeColumns(db);
  const indexesExistedBefore = await hasPerMarketScopeIndexes(db);
  const ddl = await runPerMarketScopeDdl(db);
  const migrationRecord = await markMigration0029Applied(db);
  const columnsExistAfter = await hasPerMarketScopeColumns(db);
  const indexesExistAfter = await hasPerMarketScopeIndexes(db);

  return {
    ok: true,
    columnsExistedBefore,
    indexesExistedBefore,
    ddl,
    migrationRecord,
    columnsExistAfter,
    indexesExistAfter,
  };
}
