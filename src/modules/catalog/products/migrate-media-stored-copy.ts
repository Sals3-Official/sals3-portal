import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * One-time, idempotent DDL for the Sals3-hosted copy of a supplier photo
 * (`product_media_sources.stored_url` / `stored_at`).
 *
 * ## What it is for
 *
 * ADR-007's `Media locking` promises that *"if a supplier later replaces or
 * removes a file at the same URL, the order, receipt, return, dispute, and
 * support surfaces continue showing the original accepted media."* That is false
 * today for a `SUPPLIER_ORIGINAL` row: `source_url` is a CJ CDN address, and the
 * order snapshot freezes the **address**, not the bytes. If CJ replaces that
 * file, a two-year-old order's gallery silently changes — the exact failure the
 * section exists to prevent, in the one case nobody sees until a dispute.
 *
 * These two columns are where the durable copy's address and capture time go.
 * `source_url` is left exactly as it is: it is provenance (ADR-011 §6 — where
 * the asset came from), and overwriting it would trade one gap for another.
 *
 * ## Why this ships with no Drizzle schema change
 *
 * Same rule the order-line snapshot column established, and for the same
 * reason: **Drizzle names every column of the schema in an `INSERT`**, filling
 * omitted ones with `default`. So adding `storedUrl` to `schema/product-catalog.ts`
 * is by itself enough to make every media write emit
 * `insert into product_media_sources (..., "stored_url", ...)` and fail against a
 * database that does not have it. `product_media_sources` is written by draft
 * creation, by publication, and by every seller upload, so that would break
 * importing and publishing, not one page.
 *
 * The columns therefore enter the Drizzle table in the change that also reads
 * them, deployed only after a run here reports `columnsExistAfter: true`. The
 * `drizzle/` migration file and its `__drizzle_migrations` bookkeeping travel
 * with that change, because a ledger row pointing at a file that does not exist
 * yet is worse than no row.
 */

export const MEDIA_STORED_COPY_DDL_STATEMENTS = [
  'ALTER TABLE "product_media_sources" ADD COLUMN IF NOT EXISTS "stored_url" text',
  'ALTER TABLE "product_media_sources" ADD COLUMN IF NOT EXISTS "stored_at" timestamp with time zone',
] as const;

/**
 * The real hazard is the lock, not the columns. `ALTER TABLE` takes an
 * `ACCESS EXCLUSIVE` lock on `product_media_sources`; if a long query holds the
 * table, the ALTER queues and every catalogue read and media write queues behind
 * it. Failing fast is the rollback story for a DDL that otherwise has none: the
 * statement aborts, the transaction rolls back, nothing changed, and the run can
 * be retried at a quieter moment.
 *
 * Both statements run in **one** transaction, so a database can never be left
 * with `stored_url` and no `stored_at` — a half-migrated table would make the
 * mirror module's "already stored?" check ambiguous.
 *
 * `SET LOCAL` rather than a session `SET`: this runs on a pooled serverless
 * connection, and a session-level timeout would leak onto whatever unrelated
 * query reuses that connection next.
 */
export const DDL_LOCK_TIMEOUT = '5s';

/**
 * Read-only. Whether both columns are actually present, asked of the database
 * rather than inferred from a migration ledger — the ledger records intent, this
 * records reality, and the 2026-08-18 incident is what happens when those two
 * disagree.
 */
export async function hasStoredCopyColumns(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'product_media_sources'
         AND column_name IN ('stored_url', 'stored_at')`,
    ),
  )) as unknown as unknown[];

  return rows.length === MEDIA_STORED_COPY_DDL_STATEMENTS.length;
}

export type RunMediaStoredCopyDdlResult = { statementsRun: number };

export async function runMediaStoredCopyDdl(
  db: Database,
): Promise<RunMediaStoredCopyDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));

    // eslint-disable-next-line no-restricted-syntax -- two fixed statements, one transaction, order irrelevant but atomicity is not.
    for (const statement of MEDIA_STORED_COPY_DDL_STATEMENTS) {
      // eslint-disable-next-line no-await-in-loop
      await tx.execute(sql.raw(statement));
    }
  });

  return { statementsRun: MEDIA_STORED_COPY_DDL_STATEMENTS.length };
}

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0027_many_lockjaw` (`when`) and
 * the sha256 of `drizzle/0027_many_lockjaw.sql`'s raw file content, computed the
 * way `drizzle-orm`'s own `readMigrationFiles()` does it. Hard-coded so this
 * endpoint never depends on the migration file being in the deployed bundle.
 * Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0027_many_lockjaw.sql').toString()).digest('hex'))"
 * only if the migration is regenerated. Pinned to the file by its own test.
 */
const MIGRATION_0027_CREATED_AT = 1787314656435;
const MIGRATION_0027_HASH =
  '0316d197d16d7828b771fcb18d9924498000d1ecf0c21764f785ea5b5c26ed73';

export type MarkMigration0027AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records `0027_many_lockjaw` as applied, so a later real `npm run db:migrate`
 * does not try to run it again. Idempotent by construction; the values are fixed
 * constants, not request input, so the raw SQL carries no injection risk.
 */
export async function markMigration0027Applied(
  db: Database,
): Promise<MarkMigration0027AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0027_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0027_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0027_HASH}', ${MIGRATION_0027_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0027_CREATED_AT, inserted: true };
}

export type MigrateMediaStoredCopyResult = {
  ok: true;
  /** `true` means this run was already a no-op. */
  columnsExistedBefore: boolean;
  ddl: RunMediaStoredCopyDdlResult;
  migrationRecord: MarkMigration0027AppliedResult;
  /**
   * Re-read from `information_schema` *after* the DDL. This is the field an
   * operator should trust: a 200 with `columnsExistAfter: false` would mean the
   * run reported success without achieving anything.
   */
  columnsExistAfter: boolean;
};

export async function migrateMediaStoredCopy(
  db: Database,
): Promise<MigrateMediaStoredCopyResult> {
  const columnsExistedBefore = await hasStoredCopyColumns(db);
  const ddl = await runMediaStoredCopyDdl(db);
  const migrationRecord = await markMigration0027Applied(db);
  const columnsExistAfter = await hasStoredCopyColumns(db);

  return {
    ok: true,
    columnsExistedBefore,
    ddl,
    migrationRecord,
    columnsExistAfter,
  };
}
