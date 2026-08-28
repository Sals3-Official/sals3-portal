import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0033_normal_magus` (`when`) and
 * the sha256 of `drizzle/0033_normal_magus.sql`'s raw file content, computed
 * exactly the way `drizzle-orm`'s own `readMigrationFiles()` does it. Hard-coded
 * rather than read from disk at runtime, same reasoning
 * `migrate-shipping-tier.ts` gives: this endpoint must never depend on the
 * migration file being present in the deployed serverless bundle. Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0033_normal_magus.sql').toString()).digest('hex'))"
 * if this migration is ever regenerated (only then).
 */
const MIGRATION_0033_CREATED_AT = 1787903846051;
const MIGRATION_0033_HASH =
  'b9d43f64be946c147bb1b8cf847b560d5d55c73f95ae5cba314d5802c2dd74b2';

/**
 * One-time, idempotent DDL for the verified account id on a checkout intent and
 * the order it becomes (`buyer_uid`) — reachable only through
 * `/api/internal/orders/migrate-buyer-uid`, the same break-glass pattern
 * `migrate-shipping-tier.ts` established: a local `npm run db:migrate` only ever
 * reaches a local database (`scripts/guard-remote-db.mts` refuses anything
 * else), so the deployed environment needs its own authenticated path to apply
 * new DDL, never a raw production `DATABASE_URL` handled on a laptop.
 *
 * Nullable with no default, deliberately. Every order accepted before this
 * migration was placed without a recorded uid, and inventing one would be worse
 * than having none: `buyer-read.ts` authorizes a row *by uid alone* once it has
 * one, so a wrong value would lock a buyer out of their own order permanently.
 * Null means "authorize this row by email", which is what those orders have
 * always done.
 *
 * The buyer order list filters on this column, hence the index.
 */
export const BUYER_UID_DDL_STATEMENTS = [
  'ALTER TABLE "checkout_intents" ADD COLUMN IF NOT EXISTS "buyer_uid" text',
  'ALTER TABLE "sals3_orders" ADD COLUMN IF NOT EXISTS "buyer_uid" text',
  'CREATE INDEX IF NOT EXISTS "sals3_orders_buyer_uid_idx" ON "sals3_orders" USING btree ("buyer_uid")',
] as const;

/**
 * The real hazard is the lock, not the columns. `ALTER TABLE` takes an
 * `ACCESS EXCLUSIVE` lock; if a long-running query holds either table, the
 * ALTER queues *and every subsequent read queues behind it*, taking the buyer's
 * order history and the checkout accept path down — and mid-DDL there is
 * nothing to roll back to.
 *
 * `SET LOCAL lock_timeout` bounds that: a lock it cannot acquire aborts, the
 * transaction rolls back, nothing changed, and the run is safe to retry when
 * the database is quieter. `SET LOCAL` rather than a session `SET` because this
 * runs on a pooled serverless connection and a session timeout would leak onto
 * whatever unrelated query reuses it next.
 */
export const DDL_LOCK_TIMEOUT = '5s';

async function columnExists(
  db: Database,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = '${table}' AND column_name = '${column}'
       LIMIT 1`,
    ),
  )) as unknown as unknown[];

  return rows.length > 0;
}

/**
 * Read-only. Both columns, asked of the database rather than inferred from the
 * migration ledger — the ledger records intent, this records reality, and the
 * 2026-08-12 outage is what happens when the two disagree.
 */
export async function hasBuyerUidColumns(db: Database): Promise<boolean> {
  const onIntents = await columnExists(db, 'checkout_intents', 'buyer_uid');
  const onOrders = await columnExists(db, 'sals3_orders', 'buyer_uid');

  return onIntents && onOrders;
}

export type RunBuyerUidDdlResult = { statementsRun: number };

export async function runBuyerUidDdl(
  db: Database,
): Promise<RunBuyerUidDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));

    // Sequential inside one transaction: the two columns and the index either
    // all land or none do, so the deployment can never meet a half-migrated
    // schema.
    /* eslint-disable no-await-in-loop -- DDL order matters; the index needs its column. */
    // eslint-disable-next-line no-restricted-syntax -- sequential DDL chain.
    for (const statement of BUYER_UID_DDL_STATEMENTS) {
      await tx.execute(sql.raw(statement));
    }
    /* eslint-enable no-await-in-loop */
  });

  return { statementsRun: BUYER_UID_DDL_STATEMENTS.length };
}

export type MarkMigration0033AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records `0033_normal_magus` as applied in `drizzle.__drizzle_migrations`, same
 * mechanism as `markMigration0032Applied`: without it a later real
 * `npm run db:migrate` has no record of 0033 and re-runs it. Harmless for the
 * `IF NOT EXISTS` statements, recorded anyway so the ledger stays a true history
 * of what has actually been applied.
 *
 * Idempotent by construction. Values are fixed constants, not request input, so
 * raw SQL here carries no injection risk.
 */
export async function markMigration0033Applied(
  db: Database,
): Promise<MarkMigration0033AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0033_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0033_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0033_HASH}', ${MIGRATION_0033_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0033_CREATED_AT, inserted: true };
}

export type MigrateBuyerUidResult = {
  ok: true;
  columnsExistedBefore: boolean;
  ddl: RunBuyerUidDdlResult;
  migrationRecord: MarkMigration0033AppliedResult;
  /**
   * Re-read after the DDL. This is the field the operator should trust: a 200
   * with `columnsExistAfter: false` would mean the run reported success without
   * achieving anything.
   */
  columnsExistAfter: boolean;
};

export async function migrateBuyerUid(
  db: Database,
): Promise<MigrateBuyerUidResult> {
  const columnsExistedBefore = await hasBuyerUidColumns(db);
  const ddl = await runBuyerUidDdl(db);
  const migrationRecord = await markMigration0033Applied(db);
  const columnsExistAfter = await hasBuyerUidColumns(db);

  return {
    ok: true,
    columnsExistedBefore,
    ddl,
    migrationRecord,
    columnsExistAfter,
  };
}
