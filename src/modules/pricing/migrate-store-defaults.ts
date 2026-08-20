import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0024_spicy_nemesis` (`when`)
 * and the sha256 of `drizzle/0024_spicy_nemesis.sql`'s raw file content,
 * computed exactly the way `drizzle-orm`'s own `readMigrationFiles()` does it
 * (`crypto.createHash('sha256').update(fs.readFileSync(path).toString()).digest('hex')`
 * - see `node_modules/drizzle-orm/migrator.cjs`). Hard-coded rather than read
 * from disk at runtime, same reasoning `migrate-show-supplier-photo.ts`
 * gives: this endpoint must never depend on the migration file being present
 * in the deployed serverless bundle. Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0024_spicy_nemesis.sql').toString()).digest('hex'))"
 * if this migration is ever regenerated (only then - this value must never
 * change for the shipped 0024 migration).
 */
const MIGRATION_0024_CREATED_AT = 1787143758012;
const MIGRATION_0024_HASH =
  'a11d1e740081e5c7d7249cc1965c517e77ec4bfb2dae756d474e4b52049ab270';

/**
 * One-time, idempotent DDL for the seller store-default pricing table
 * (`pricing_store_defaults`, ADR-015 §3's "seller/store default" layer) -
 * reachable only through `/api/internal/pricing/migrate-store-defaults`,
 * the break-glass pattern `migrate-meta-description.ts`,
 * `migrate-attribute-controls.ts` and `migrate-show-supplier-photo.ts`
 * established: a local `npm run db:migrate` only ever reaches a local
 * database (`scripts/guard-remote-db.mts` refuses anything else), so the
 * deployed environment needs its own authenticated path to apply new DDL,
 * never a raw production `DATABASE_URL` handled on a laptop.
 *
 * Every statement is `IF NOT EXISTS`, so a second call is a no-op with no
 * error-code tolerance logic needed. The FK is added via a guarded DO block
 * because `ADD CONSTRAINT IF NOT EXISTS` does not exist in Postgres.
 *
 * Both enum types this table references (`rounding_rule`,
 * `pricing_policy_status`) shipped in migration `0012_flashy_penance`,
 * which the portal's own README records as applied in production - this
 * migration deliberately does not recreate them, so running it against a
 * database that never saw 0012 fails loudly instead of half-creating a
 * pricing schema.
 */
export const STORE_DEFAULTS_DDL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "pricing_store_defaults" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "seller_account_id" uuid NOT NULL,
    "target_margin_rate" numeric(8, 6) NOT NULL,
    "min_contribution_minor" bigint DEFAULT 0 NOT NULL,
    "min_contribution_currency" text DEFAULT 'USD' NOT NULL,
    "rounding_rule" "rounding_rule" DEFAULT 'NONE' NOT NULL,
    "status" "pricing_policy_status" DEFAULT 'ACTIVE' NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "supersedes_id" uuid,
    "reason" text NOT NULL,
    "actor_id" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'pricing_store_defaults_seller_account_id_seller_accounts_id_fk'
    ) THEN
      ALTER TABLE "pricing_store_defaults"
        ADD CONSTRAINT "pricing_store_defaults_seller_account_id_seller_accounts_id_fk"
        FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id")
        ON DELETE restrict ON UPDATE no action;
    END IF;
  END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "pricing_store_defaults_active_key" ON "pricing_store_defaults" USING btree ("seller_account_id") WHERE "pricing_store_defaults"."status" = 'ACTIVE'`,
  `CREATE INDEX IF NOT EXISTS "pricing_store_defaults_seller_idx" ON "pricing_store_defaults" USING btree ("seller_account_id")`,
];

/**
 * The real hazard is the lock, not the table - `SET LOCAL lock_timeout`
 * bounds the ACCESS EXCLUSIVE wait so a busy database aborts the
 * transaction cleanly (nothing half-applied, safe to re-run at a quieter
 * moment) instead of queueing every later read behind it. `SET LOCAL`
 * rather than a session `SET` on purpose: this runs on a pooled serverless
 * connection, and a session-level timeout would leak onto whatever
 * unrelated query reuses that connection next.
 */
export const DDL_LOCK_TIMEOUT = '5s';

/**
 * Read-only. Whether the table is actually present, asked of the database
 * rather than inferred from a migration ledger - the ledger records intent,
 * this records reality (the 2026-08-18 incident is exactly those two
 * disagreeing).
 */
export async function hasStoreDefaultsTable(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.tables
       WHERE table_name = 'pricing_store_defaults'
       LIMIT 1`,
    ),
  )) as unknown as unknown[];

  return rows.length > 0;
}

export type RunStoreDefaultsDdlResult = { statementsRun: number };

export async function runStoreDefaultsDdl(
  db: Database,
): Promise<RunStoreDefaultsDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));

    /* eslint-disable no-await-in-loop */
    // eslint-disable-next-line no-restricted-syntax -- sequential DDL inside one transaction, in declaration order.
    for (const statement of STORE_DEFAULTS_DDL_STATEMENTS) {
      await tx.execute(sql.raw(statement));
    }
    /* eslint-enable no-await-in-loop */
  });

  return { statementsRun: STORE_DEFAULTS_DDL_STATEMENTS.length };
}

export type MarkMigration0024AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records migration `0024_spicy_nemesis` as applied in
 * `drizzle.__drizzle_migrations`, same reasoning and mechanism as
 * `markMigration0022Applied`: without this, a later real
 * `npm run db:migrate` against this database has no record of 0024 and
 * tries to run it again - harmless here specifically because every
 * statement is `IF NOT EXISTS`, but recorded anyway so the ledger stays a
 * true history of what has actually been applied.
 *
 * Idempotent by construction: only inserts when no row with this exact
 * `created_at` exists yet. Values are fixed constants, not request input,
 * so raw SQL here carries no injection risk.
 */
export async function markMigration0024Applied(
  db: Database,
): Promise<MarkMigration0024AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0024_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0024_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0024_HASH}', ${MIGRATION_0024_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0024_CREATED_AT, inserted: true };
}

export type MigrateStoreDefaultsResult = {
  ok: true;
  /** The table's real state before this run - `true` means it was already a no-op. */
  tableExistedBefore: boolean;
  ddl: RunStoreDefaultsDdlResult;
  migrationRecord: MarkMigration0024AppliedResult;
  /**
   * Re-read from `information_schema` *after* the DDL. This is the field
   * the operator should actually trust: a 200 with `tableExistsAfter:
   * false` would mean the run reported success without achieving anything -
   * precisely the class of false confidence this endpoint pattern exists
   * to prevent.
   */
  tableExistsAfter: boolean;
};

/**
 * Orchestrates the full break-glass run: observe, DDL, mark `0024` applied,
 * then re-observe. Sequential `await`s with no swallowed errors in between -
 * if any step throws, this function throws too and the route handler
 * reports a 500 rather than a false success.
 */
export async function migrateStoreDefaults(
  db: Database,
): Promise<MigrateStoreDefaultsResult> {
  const tableExistedBefore = await hasStoreDefaultsTable(db);
  const ddl = await runStoreDefaultsDdl(db);
  const migrationRecord = await markMigration0024Applied(db);
  const tableExistsAfter = await hasStoreDefaultsTable(db);

  return {
    ok: true,
    tableExistedBefore,
    ddl,
    migrationRecord,
    tableExistsAfter,
  };
}
