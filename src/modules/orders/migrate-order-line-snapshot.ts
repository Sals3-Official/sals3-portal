import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

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
 * ## Why this ships with no Drizzle schema change at all
 *
 * `sals3_order_lines` is the money path, so the DDL has to land before any code
 * mentions the column. That is stronger than it sounds: **Drizzle names every
 * column of the schema in an `INSERT`**, filling omitted ones with `default`, so
 * merely adding `listingSnapshot` to `schema/orders.ts` is enough to make order
 * acceptance emit `insert into sals3_order_lines (..., "listing_snapshot", ...)`
 * and fail every paid checkout with `column ... does not exist`. Verified by
 * `toSQL()`, and pinned by `order-line-columns.test.ts`.
 *
 * So this change carries the raw DDL and nothing else: no schema column, no
 * `drizzle/` migration file, no ledger entry. The column enters the Drizzle
 * schema in the same change as the code that reads it, which deploys only after
 * a run here has reported `columnExistsAfter: true`. The migration file and its
 * `__drizzle_migrations` bookkeeping travel with that schema change, because a
 * ledger row pointing at a file that does not exist yet is worse than no row.
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

export type MigrateOrderLineSnapshotResult = {
  ok: true;
  /** The column's real state before this run — `true` means it was already a no-op. */
  columnExistedBefore: boolean;
  ddl: RunOrderLineSnapshotDdlResult;
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
  const columnExistsAfter = await hasListingSnapshotColumn(db);

  return { ok: true, columnExistedBefore, ddl, columnExistsAfter };
}
