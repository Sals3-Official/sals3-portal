import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0021_cultured_groot` (`when`)
 * and the sha256 of `drizzle/0021_cultured_groot.sql`'s raw file content,
 * computed exactly the way `drizzle-orm`'s own `readMigrationFiles()` does it
 * (`crypto.createHash('sha256').update(fs.readFileSync(path).toString()).digest('hex')`
 * - see `node_modules/drizzle-orm/migrator.cjs`). Hard-coded rather than read
 * from disk at runtime, same reasoning `migrate-attribute-controls.ts` gives:
 * this endpoint must never depend on the migration file being present in the
 * deployed serverless bundle. Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0021_cultured_groot.sql').toString()).digest('hex'))"
 * if this migration is ever regenerated (only then - this value must never
 * change for the already-shipped 0021 migration).
 */
const MIGRATION_0021_CREATED_AT = 1786964683744;
const MIGRATION_0021_HASH =
  'f368e903d72c8f41ae3088f2726848d375da83cf25458d423653222af51cfb7d';

/**
 * One-time, idempotent DDL for the Meta Description feature
 * (`products.meta_description`) - reachable only through
 * `/api/internal/catalog/products/migrate-meta-description`, same
 * break-glass pattern `migrate-attribute-controls.ts` established: a local
 * `npm run db:migrate` only ever reaches a local database
 * (`scripts/guard-remote-db.mts` refuses anything else), so the deployed
 * environment needs its own authenticated path to apply new DDL, never a
 * raw production `DATABASE_URL` handled on a laptop.
 *
 * Simpler than the attribute-controls migration by nature, not by cut
 * corners: this is a single nullable `ALTER TABLE ... ADD COLUMN`, and
 * Postgres supports `IF NOT EXISTS` on `ADD COLUMN` directly (unlike
 * `CREATE TYPE`/`ADD CONSTRAINT`, which needed the try/catch-on-duplicate
 * dance in `migrate-attribute-controls.ts`) - so this is safe to call more
 * than once with no error-code tolerance logic needed at all. No seed step:
 * there is no reference data for a seller-authored text field.
 */
export const META_DESCRIPTION_DDL_STATEMENT =
  'ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "meta_description" text';

export type RunMetaDescriptionDdlResult = { statementsRun: number };

export async function runMetaDescriptionDdl(
  db: Database,
): Promise<RunMetaDescriptionDdlResult> {
  await db.execute(sql.raw(META_DESCRIPTION_DDL_STATEMENT));

  return { statementsRun: 1 };
}

export type MarkMigration0021AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records migration `0021_cultured_groot` as applied in
 * `drizzle.__drizzle_migrations`, same reasoning and mechanism as
 * `markMigration0020Applied`: without this, a later real
 * `npm run db:migrate` against this database has no record of 0021 and
 * tries to run it again - harmless here specifically because `ADD COLUMN IF
 * NOT EXISTS` tolerates that, but recorded anyway so the migration ledger
 * stays a true history of what has actually been applied.
 *
 * Idempotent by construction: only inserts when no row with this exact
 * `created_at` exists yet. Values are fixed constants, not request input, so
 * raw SQL here carries no injection risk.
 */
export async function markMigration0021Applied(
  db: Database,
): Promise<MarkMigration0021AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0021_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0021_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0021_HASH}', ${MIGRATION_0021_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0021_CREATED_AT, inserted: true };
}

export type MigrateMetaDescriptionResult = {
  ok: true;
  ddl: RunMetaDescriptionDdlResult;
  migrationRecord: MarkMigration0021AppliedResult;
};

/**
 * Orchestrates the full break-glass run: DDL, then marking `0021` applied.
 * Sequential `await`s with no swallowed errors in between - if either step
 * throws, this function throws too and the route handler reports a 500
 * rather than a false success.
 */
export async function migrateMetaDescription(
  db: Database,
): Promise<MigrateMetaDescriptionResult> {
  const ddl = await runMetaDescriptionDdl(db);
  const migrationRecord = await markMigration0021Applied(db);

  return { ok: true, ddl, migrationRecord };
}
