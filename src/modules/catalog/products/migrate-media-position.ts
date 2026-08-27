import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * One-time, idempotent DDL for the seller's own gallery arrangement
 * (`product_media_sources.position`).
 *
 * ## What it is for
 *
 * ADR-011 §3 made the supplier's photos a *"read-only source set"* and the
 * Product Editor treated them that way: never reorderable, never a cover choice.
 * The owner's decision of 2026-08-28 amends that — a seller arranges **every**
 * photo of their product, the supplier's originals included, and the first one is
 * the cover. Cover choice was also never persisted (owner decision 2026-08-20
 * left it unstored), so "make this the main photo" survived until the next
 * render and no further.
 *
 * This column is where that arrangement goes. **The cover is position 0**: one
 * ordering answers both "what order" and "which is main", rather than a second
 * `is_cover` column that can disagree with the first.
 *
 * `source_url`, `checksum`, `observed_at`, `rights_basis` and `review_state` are
 * untouched by any reorder. That is the whole of the amendment's argument:
 * display order is a Sals3 editorial fact *about* supplier evidence, not a
 * change *to* it — the same distinction `assign-variant-media.ts` already draws
 * for `variant_id`, and the reason a supplier row was always assignable to a
 * variant while never being reorderable was an inconsistency rather than a rule.
 *
 * ## Why nothing needs backfilling
 *
 * The column is nullable and null means "never arranged". Read paths order
 * `position asc nulls last` and then fall through to the previous rule — seller
 * uploads first, then oldest observation — so a product nobody has touched keeps
 * exactly the order it has today. A backfill would have to invent an arrangement
 * the seller never chose, and then the null/not-null distinction that makes this
 * safe would be gone.
 *
 * ## Why this ships before the code that reads it
 *
 * Same rule as `migrate-media-stored-copy.ts`, same reason, and the 2026-08-18
 * incident is what it is written against: **Drizzle names every column of the
 * schema in an `INSERT`**, filling omitted ones with `default`. Adding
 * `position` to `schema/product-catalog.ts` is by itself enough to make every
 * media write emit `insert into product_media_sources (..., "position", ...)`
 * and fail against a database that does not have it. This table is written by
 * draft creation, by publication, and by every seller upload — so a deployment
 * naming a column the database lacks breaks importing and publishing, not one
 * page.
 *
 * A run here must report `columnExistsAfter: true` **before** the deployment
 * carrying the schema change and the reorder feature.
 */

export const MEDIA_POSITION_DDL_STATEMENTS = [
  'ALTER TABLE "product_media_sources" ADD COLUMN IF NOT EXISTS "position" integer',
] as const;

/**
 * The real hazard is the lock, not the column. `ALTER TABLE` takes an
 * `ACCESS EXCLUSIVE` lock on `product_media_sources`; if a long query holds the
 * table, the ALTER queues and every catalogue read and media write queues behind
 * it. Failing fast is the rollback story for a DDL that otherwise has none: the
 * statement aborts, the transaction rolls back, nothing changed, and the run can
 * be retried at a quieter moment.
 *
 * `SET LOCAL` rather than a session `SET`: this runs on a pooled serverless
 * connection, and a session-level timeout would leak onto whatever unrelated
 * query reuses that connection next.
 */
export const DDL_LOCK_TIMEOUT = '5s';

/**
 * Read-only. Whether the column is actually present, asked of the database
 * rather than inferred from a migration ledger — the ledger records intent, this
 * records reality, and the 2026-08-18 incident is what happens when those two
 * disagree.
 */
export async function hasMediaPositionColumn(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'product_media_sources'
         AND column_name = 'position'`,
    ),
  )) as unknown as unknown[];

  return rows.length === MEDIA_POSITION_DDL_STATEMENTS.length;
}

export type RunMediaPositionDdlResult = { statementsRun: number };

export async function runMediaPositionDdl(
  db: Database,
): Promise<RunMediaPositionDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));

    // eslint-disable-next-line no-restricted-syntax -- one fixed statement, kept as a loop so adding a second cannot forget the transaction.
    for (const statement of MEDIA_POSITION_DDL_STATEMENTS) {
      // eslint-disable-next-line no-await-in-loop
      await tx.execute(sql.raw(statement));
    }
  });

  return { statementsRun: MEDIA_POSITION_DDL_STATEMENTS.length };
}

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0031_unusual_gargoyle` (`when`)
 * and the sha256 of `drizzle/0031_unusual_gargoyle.sql`'s raw file content,
 * computed the way `drizzle-orm`'s own `readMigrationFiles()` does it.
 * Hard-coded so this endpoint never depends on the migration file being in the
 * deployed bundle. Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0031_unusual_gargoyle.sql').toString()).digest('hex'))"
 * only if the migration is regenerated. Pinned to the file by its own test.
 */
const MIGRATION_0031_CREATED_AT = 1787862669015;
const MIGRATION_0031_HASH =
  '1d215efdfed87358aa0718c70898c5c93c81b7448eff31703fa40543a17e1441';

export type MarkMigration0031AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records `0031_unusual_gargoyle` as applied, so a later real
 * `npm run db:migrate` does not try to run it again. Idempotent by
 * construction; the values are fixed constants, not request input, so the raw
 * SQL carries no injection risk.
 */
export async function markMigration0031Applied(
  db: Database,
): Promise<MarkMigration0031AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0031_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0031_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0031_HASH}', ${MIGRATION_0031_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0031_CREATED_AT, inserted: true };
}

export type MigrateMediaPositionResult = {
  ok: true;
  /** `true` means this run was already a no-op. */
  columnExistedBefore: boolean;
  ddl: RunMediaPositionDdlResult;
  migrationRecord: MarkMigration0031AppliedResult;
  /**
   * Re-read from `information_schema` *after* the DDL. This is the field an
   * operator should trust: a 200 with `columnExistsAfter: false` would mean the
   * run reported success without achieving anything.
   */
  columnExistsAfter: boolean;
};

export async function migrateMediaPosition(
  db: Database,
): Promise<MigrateMediaPositionResult> {
  const columnExistedBefore = await hasMediaPositionColumn(db);
  const ddl = await runMediaPositionDdl(db);
  const migrationRecord = await markMigration0031Applied(db);
  const columnExistsAfter = await hasMediaPositionColumn(db);

  return {
    ok: true,
    columnExistedBefore,
    ddl,
    migrationRecord,
    columnExistsAfter,
  };
}
