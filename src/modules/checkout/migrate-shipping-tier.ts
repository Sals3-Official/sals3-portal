import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0032_strict_shipping_tiers`
 * (`when`) and the sha256 of `drizzle/0032_strict_shipping_tiers.sql`'s raw
 * file content, computed exactly the way `drizzle-orm`'s own
 * `readMigrationFiles()` does it
 * (`crypto.createHash('sha256').update(fs.readFileSync(path).toString()).digest('hex')`
 * - see `node_modules/drizzle-orm/migrator.cjs`). Hard-coded rather than read
 * from disk at runtime, same reasoning `migrate-show-supplier-photo.ts` gives:
 * this endpoint must never depend on the migration file being present in the
 * deployed serverless bundle. Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0032_strict_shipping_tiers.sql').toString()).digest('hex'))"
 * if this migration is ever regenerated (only then - this value must never
 * change for the already-shipped 0032 migration).
 */
const MIGRATION_0032_CREATED_AT = 1787892991698;
const MIGRATION_0032_HASH =
  'ad1ab04eb6f8ea568c54fa493a1808e34b287c4755ae32e0b78dfbdf44610a91';

/**
 * One-time, idempotent DDL for the shipping tier recorded on an accepted
 * order (`fulfillment_groups.shipping_tier`) - reachable only through
 * `/api/internal/orders/migrate-shipping-tier`, the same break-glass pattern
 * `migrate-show-supplier-photo.ts` established: a local `npm run db:migrate`
 * only ever reaches a local database (`scripts/guard-remote-db.mts` refuses
 * anything else), so the deployed environment needs its own authenticated
 * path to apply new DDL, never a raw production `DATABASE_URL` handled on a
 * laptop.
 *
 * Nullable with no default, deliberately. Every order accepted before this
 * migration has no tier, and a default would hand all of them the same
 * invented promise - `Standard` on an order that may well have shipped
 * express. A null here reads as "this order predates tiers", which is true,
 * and `buyer-read.ts` renders those orders from what they actually recorded.
 */
export const SHIPPING_TIER_COLUMN_DDL_STATEMENT =
  'ALTER TABLE "fulfillment_groups" ADD COLUMN IF NOT EXISTS "shipping_tier" text';

/**
 * Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so the guard is written by
 * hand against `pg_constraint`. Without it a second run of this endpoint
 * fails with `constraint ... already exists` - which would make the retry
 * story worse than the migration it is protecting, since the operator cannot
 * tell a genuinely failed run from an already-succeeded one.
 *
 * The constraint admits null so it does not reject the pre-tier rows the
 * column deliberately leaves empty.
 */
export const SHIPPING_TIER_CONSTRAINT_DDL_STATEMENT = `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fulfillment_groups_shipping_tier_check'
      AND conrelid = 'public.fulfillment_groups'::regclass
  ) THEN
    ALTER TABLE "fulfillment_groups"
      ADD CONSTRAINT "fulfillment_groups_shipping_tier_check"
      CHECK ("fulfillment_groups"."shipping_tier" is null
             or "fulfillment_groups"."shipping_tier" in ('Standard', 'Express', 'Expedited'));
  END IF;
END $$`;

/**
 * The real hazard in this migration is not the column, it is the lock.
 * `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock on `fulfillment_groups`; if
 * any long-running query is holding the table, the ALTER queues *and every
 * subsequent read queues behind it*, which takes the buyer's order history
 * and the seller's order lanes down exactly the way a missing column would -
 * except mid-DDL there is nothing to roll back to.
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
 * this records reality, and the whole point of the 2026-08-12 outage is that
 * those two can disagree.
 */
export async function hasShippingTierColumn(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'fulfillment_groups' AND column_name = 'shipping_tier'
       LIMIT 1`,
    ),
  )) as unknown as unknown[];

  return rows.length > 0;
}

/**
 * Read-only. Reported separately from the column because the two can genuinely
 * diverge: a run that timed out on the lock between the two statements leaves
 * the column present and the constraint absent, and an operator reading only
 * `columnExists` would call that done.
 */
export async function hasShippingTierConstraint(
  db: Database,
): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM pg_constraint
       WHERE conname = 'fulfillment_groups_shipping_tier_check'
       LIMIT 1`,
    ),
  )) as unknown as unknown[];

  return rows.length > 0;
}

export type RunShippingTierDdlResult = { statementsRun: number };

export async function runShippingTierDdl(
  db: Database,
): Promise<RunShippingTierDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));
    await tx.execute(sql.raw(SHIPPING_TIER_COLUMN_DDL_STATEMENT));
    await tx.execute(sql.raw(SHIPPING_TIER_CONSTRAINT_DDL_STATEMENT));
  });

  return { statementsRun: 2 };
}

export type MarkMigration0032AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records migration `0032_strict_shipping_tiers` as applied in
 * `drizzle.__drizzle_migrations`, same reasoning and mechanism as
 * `markMigration0022Applied`: without this, a later real `npm run db:migrate`
 * against this database has no record of 0032 and tries to run it again.
 * Harmless for the column, which is `IF NOT EXISTS`, but *not* harmless for
 * the constraint - the generated migration file adds it unguarded and would
 * fail - so the ledger entry is what keeps a future migrate run clean.
 *
 * Idempotent by construction: only inserts when no row with this exact
 * `created_at` exists yet. Values are fixed constants, not request input, so
 * raw SQL here carries no injection risk.
 */
export async function markMigration0032Applied(
  db: Database,
): Promise<MarkMigration0032AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0032_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0032_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0032_HASH}', ${MIGRATION_0032_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0032_CREATED_AT, inserted: true };
}

export type MigrateShippingTierResult = {
  ok: true;
  /** The column's real state before this run - `true` means it was already a no-op. */
  columnExistedBefore: boolean;
  constraintExistedBefore: boolean;
  ddl: RunShippingTierDdlResult;
  migrationRecord: MarkMigration0032AppliedResult;
  /**
   * Re-read from the catalog *after* the DDL. These are the fields the
   * operator should actually trust: a 200 with `columnExistsAfter: false`
   * would mean the run reported success without achieving anything, which is
   * precisely the class of false confidence this endpoint exists to prevent.
   */
  columnExistsAfter: boolean;
  constraintExistsAfter: boolean;
};

/**
 * Orchestrates the full break-glass run: observe, DDL, mark `0032` applied,
 * then re-observe. Sequential `await`s with no swallowed errors in between -
 * if any step throws, this function throws too and the route handler reports
 * a 500 rather than a false success.
 *
 * The before/after reads are what make this operation checkable rather than
 * trusted. They cost four trivial catalog queries and turn "the workflow went
 * green" into "the column and its constraint are provably there".
 */
export async function migrateShippingTier(
  db: Database,
): Promise<MigrateShippingTierResult> {
  const columnExistedBefore = await hasShippingTierColumn(db);
  const constraintExistedBefore = await hasShippingTierConstraint(db);
  const ddl = await runShippingTierDdl(db);
  const migrationRecord = await markMigration0032Applied(db);
  const columnExistsAfter = await hasShippingTierColumn(db);
  const constraintExistsAfter = await hasShippingTierConstraint(db);

  return {
    ok: true,
    columnExistedBefore,
    constraintExistedBefore,
    ddl,
    migrationRecord,
    columnExistsAfter,
    constraintExistsAfter,
  };
}
