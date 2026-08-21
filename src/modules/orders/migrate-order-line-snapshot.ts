import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0026_daily_blockbuster`
 * (`when`) and the sha256 of `drizzle/0026_daily_blockbuster.sql`'s raw file
 * content, computed exactly the way `drizzle-orm`'s own
 * `readMigrationFiles()` does it
 * (`crypto.createHash('sha256').update(fs.readFileSync(path).toString()).digest('hex')`).
 * Hard-coded rather than read from disk at runtime, same reasoning
 * `migrate-show-supplier-photo.ts` gives: this endpoint must never depend on
 * the migration file being present in the deployed serverless bundle.
 * Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0026_daily_blockbuster.sql').toString()).digest('hex'))"
 * if this migration is ever regenerated (only then — this value must never
 * change for the already-shipped 0026 migration).
 */
const MIGRATION_0026_CREATED_AT = 1787303522694;
const MIGRATION_0026_HASH =
  '216774787bd58281bce871c99c0e8d3c4e5c96621a1b38f3166a63d7299d00da';

/**
 * One-time, idempotent DDL for the per-order listing snapshot
 * (`sals3_order_lines.listing_snapshot`) — reachable only through
 * `/api/internal/orders/migrate-order-line-snapshot`, the same break-glass
 * pattern `migrate-show-supplier-photo.ts` and `migrate-attribute-controls.ts`
 * established. A local `npm run db:migrate` only ever reaches a local database
 * (`scripts/guard-remote-db.mts` refuses anything else), so the deployed
 * environment needs its own authenticated path to apply new DDL and no raw
 * production `DATABASE_URL` is ever handled on a laptop.
 *
 * ## Why this one ships on its own, ahead of the code that uses it
 *
 * `sals3_order_lines` is the money path. The moment order acceptance inserts
 * this column or the buyer projection selects it, a deployment that lands
 * before the column exists turns every paid checkout into
 * `column "listing_snapshot" does not exist` — the PR #102 and PR #113 failure
 * class, this time in front of money. So the column arrives first, in a change
 * that reads and writes nothing, and the capture code follows only once
 * `columnExistsAfter: true` has been observed against production.
 *
 * A plain nullable `ADD COLUMN`, so unlike a `NOT NULL DEFAULT` there is not
 * even a catalog default to reason about: existing rows keep NULL, which the
 * buyer projection is required to read as "this order predates the snapshot"
 * rather than as an empty one.
 */
export const ORDER_LINE_SNAPSHOT_DDL_STATEMENT =
  'ALTER TABLE "sals3_order_lines" ADD COLUMN IF NOT EXISTS "listing_snapshot" jsonb';

/**
 * The real hazard is the lock, not the column. `ALTER TABLE` takes an
 * `ACCESS EXCLUSIVE` lock on `sals3_order_lines`; if a long-running query
 * holds the table, the ALTER queues *and every order read and write queues
 * behind it*. On this table that means checkout acceptance, so failing fast is
 * the rollback story for a DDL that otherwise has none: the statement aborts,
 * the transaction rolls back, nothing changed, and the run can be retried at a
 * quieter moment.
 *
 * `SET LOCAL` rather than a session `SET` on purpose — this runs on a pooled
 * serverless connection, and a session-level timeout would leak onto whatever
 * unrelated query reuses that connection next.
 */
export const DDL_LOCK_TIMEOUT = '5s';

/**
 * Read-only. Whether the column is actually present, asked of the database
 * rather than inferred from a migration ledger — the ledger records intent,
 * this records reality, and the whole point of the 2026-08-18 incident is that
 * those two can disagree.
 */
export async function hasListingSnapshotColumn(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'sals3_order_lines' AND column_name = 'listing_snapshot'
       LIMIT 1`,
    ),
  )) as unknown as unknown[];

  return rows.length > 0;
}

export type RunOrderLineSnapshotDdlResult = { statementsRun: number };

export async function runOrderLineSnapshotDdl(
  db: Database,
): Promise<RunOrderLineSnapshotDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));
    await tx.execute(sql.raw(ORDER_LINE_SNAPSHOT_DDL_STATEMENT));
  });

  return { statementsRun: 1 };
}

export type MarkMigration0026AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records migration `0026_daily_blockbuster` as applied in
 * `drizzle.__drizzle_migrations`, same mechanism as `markMigration0022Applied`:
 * without it a later real `npm run db:migrate` against this database has no
 * record of 0026 and tries to run it again — harmless here specifically
 * because `ADD COLUMN IF NOT EXISTS` tolerates that, but recorded anyway so
 * the ledger stays a true history of what has actually been applied.
 *
 * Idempotent by construction: only inserts when no row with this exact
 * `created_at` exists. Values are fixed constants, not request input, so the
 * raw SQL here carries no injection risk.
 */
export async function markMigration0026Applied(
  db: Database,
): Promise<MarkMigration0026AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0026_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0026_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0026_HASH}', ${MIGRATION_0026_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0026_CREATED_AT, inserted: true };
}

export type MigrateOrderLineSnapshotResult = {
  ok: true;
  /** The column's real state before this run — `true` means it was already a no-op. */
  columnExistedBefore: boolean;
  ddl: RunOrderLineSnapshotDdlResult;
  migrationRecord: MarkMigration0026AppliedResult;
  /**
   * Re-read from `information_schema` *after* the DDL. This is the field the
   * operator should actually trust: a 200 with `columnExistsAfter: false` would
   * mean the run reported success without achieving anything, which is exactly
   * the false confidence that caused the incident this pattern exists to undo.
   */
  columnExistsAfter: boolean;
};

export async function migrateOrderLineSnapshot(
  db: Database,
): Promise<MigrateOrderLineSnapshotResult> {
  const columnExistedBefore = await hasListingSnapshotColumn(db);
  const ddl = await runOrderLineSnapshotDdl(db);
  const migrationRecord = await markMigration0026Applied(db);
  const columnExistsAfter = await hasListingSnapshotColumn(db);

  return {
    ok: true,
    columnExistedBefore,
    ddl,
    migrationRecord,
    columnExistsAfter,
  };
}
