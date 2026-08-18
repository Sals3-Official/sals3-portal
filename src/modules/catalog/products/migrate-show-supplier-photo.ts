import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0022_absent_mole_man` (`when`)
 * and the sha256 of `drizzle/0022_absent_mole_man.sql`'s raw file content,
 * computed exactly the way `drizzle-orm`'s own `readMigrationFiles()` does it
 * (`crypto.createHash('sha256').update(fs.readFileSync(path).toString()).digest('hex')`
 * - see `node_modules/drizzle-orm/migrator.cjs`). Hard-coded rather than read
 * from disk at runtime, same reasoning `migrate-meta-description.ts` gives:
 * this endpoint must never depend on the migration file being present in the
 * deployed serverless bundle. Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0022_absent_mole_man.sql').toString()).digest('hex'))"
 * if this migration is ever regenerated (only then - this value must never
 * change for the already-shipped 0022 migration).
 */
const MIGRATION_0022_CREATED_AT = 1787014422342;
const MIGRATION_0022_HASH =
  'b51148a10b309b00405513953ec16905a4fdfe2499972f005ba1c190ebd299bc';

/**
 * One-time, idempotent DDL for the "Show supplier photo" toggle
 * (`products.show_supplier_photo`) - reachable only through
 * `/api/internal/catalog/products/migrate-show-supplier-photo`, the same
 * break-glass pattern `migrate-meta-description.ts` and
 * `migrate-attribute-controls.ts` established: a local `npm run db:migrate`
 * only ever reaches a local database (`scripts/guard-remote-db.mts` refuses
 * anything else), so the deployed environment needs its own authenticated
 * path to apply new DDL, never a raw production `DATABASE_URL` handled on a
 * laptop.
 *
 * A single `ADD COLUMN IF NOT EXISTS`, so a second call is a no-op with no
 * error-code tolerance logic needed - same shape as the meta-description
 * migration.
 *
 * `NOT NULL DEFAULT true` is deliberate and safe to add to a populated table:
 * Postgres 11+ stores the default in the catalog rather than rewriting every
 * row, and `true` is the pre-existing behaviour every product already had
 * (the supplier's photo was always shown), so no existing listing changes
 * appearance when this lands.
 */
export const SHOW_SUPPLIER_PHOTO_DDL_STATEMENT =
  'ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "show_supplier_photo" boolean DEFAULT true NOT NULL';

/**
 * The real hazard in this migration is not the column, it is the lock.
 * `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock on `products`; if any
 * long-running query is holding the table, the ALTER queues *and every
 * subsequent read queues behind it*, which takes the catalogue down exactly
 * the way the missing column did - except mid-DDL there is nothing to roll
 * back to.
 *
 * `SET LOCAL lock_timeout` bounds that: if the lock cannot be acquired in
 * this window the statement aborts, the transaction rolls back, nothing has
 * changed, and the run can simply be retried at a quieter moment. Failing
 * fast is the rollback story for a DDL that otherwise has none.
 *
 * `SET LOCAL` rather than a session `SET` on purpose - this runs on a pooled
 * serverless connection, and a session-level timeout would leak onto whatever
 * unrelated query reuses that connection next.
 */
export const DDL_LOCK_TIMEOUT = '5s';

/**
 * Read-only. Whether the column is actually present, asked of the database
 * rather than inferred from a migration ledger - the ledger records intent,
 * this records reality, and the whole point of the 2026-08-18 incident is
 * that those two can disagree.
 */
export async function hasShowSupplierPhotoColumn(
  db: Database,
): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'show_supplier_photo'
       LIMIT 1`,
    ),
  )) as unknown as unknown[];

  return rows.length > 0;
}

export type RunShowSupplierPhotoDdlResult = { statementsRun: number };

export async function runShowSupplierPhotoDdl(
  db: Database,
): Promise<RunShowSupplierPhotoDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));
    await tx.execute(sql.raw(SHOW_SUPPLIER_PHOTO_DDL_STATEMENT));
  });

  return { statementsRun: 1 };
}

export type MarkMigration0022AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records migration `0022_absent_mole_man` as applied in
 * `drizzle.__drizzle_migrations`, same reasoning and mechanism as
 * `markMigration0021Applied`: without this, a later real
 * `npm run db:migrate` against this database has no record of 0022 and
 * tries to run it again - harmless here specifically because `ADD COLUMN IF
 * NOT EXISTS` tolerates that, but recorded anyway so the migration ledger
 * stays a true history of what has actually been applied.
 *
 * Idempotent by construction: only inserts when no row with this exact
 * `created_at` exists yet. Values are fixed constants, not request input, so
 * raw SQL here carries no injection risk.
 */
export async function markMigration0022Applied(
  db: Database,
): Promise<MarkMigration0022AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0022_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0022_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0022_HASH}', ${MIGRATION_0022_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0022_CREATED_AT, inserted: true };
}

export type MigrateShowSupplierPhotoResult = {
  ok: true;
  /** The column's real state before this run - `true` means it was already a no-op. */
  columnExistedBefore: boolean;
  ddl: RunShowSupplierPhotoDdlResult;
  migrationRecord: MarkMigration0022AppliedResult;
  /**
   * Re-read from `information_schema` *after* the DDL. This is the field the
   * operator should actually trust: a 200 with `columnExistsAfter: false`
   * would mean the run reported success without achieving anything, which is
   * precisely the class of false confidence that caused the incident this
   * endpoint exists to clean up.
   */
  columnExistsAfter: boolean;
};

/**
 * Orchestrates the full break-glass run: observe, DDL, mark `0022` applied,
 * then re-observe. Sequential `await`s with no swallowed errors in between -
 * if any step throws, this function throws too and the route handler reports
 * a 500 rather than a false success.
 *
 * The before/after reads are what make this operation checkable rather than
 * trusted. They cost two trivial catalog queries and turn "the workflow went
 * green" into "the column is provably there".
 */
export async function migrateShowSupplierPhoto(
  db: Database,
): Promise<MigrateShowSupplierPhotoResult> {
  const columnExistedBefore = await hasShowSupplierPhotoColumn(db);
  const ddl = await runShowSupplierPhotoDdl(db);
  const migrationRecord = await markMigration0022Applied(db);
  const columnExistsAfter = await hasShowSupplierPhotoColumn(db);

  return {
    ok: true,
    columnExistedBefore,
    ddl,
    migrationRecord,
    columnExistsAfter,
  };
}
