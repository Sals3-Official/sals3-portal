import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * One-time, idempotent DDL for buyer product reviews
 * (`sals3_product_reviews`, `sals3_product_review_replies`) — reachable only
 * through `/api/internal/reviews/migrate-product-reviews`, the same break-glass
 * pattern `migrate-attribute-controls.ts` and `migrate-order-line-snapshot.ts`
 * established. `npm run db:migrate` is only ever safe against a local database
 * (`scripts/guard-remote-db.mts` refuses anything else by design), so the
 * deployed environment needs its own authenticated path to apply new DDL and no
 * raw production `DATABASE_URL` is ever handled on a laptop.
 *
 * **This must run before the deployment that reads or writes these tables.**
 * PR #102's merge 404'd the entire Product Catalogue in production for exactly
 * this reason: its migration had only ever run against a local database. Nothing
 * in the change that adds this module reads either table.
 *
 * ## Why the Drizzle schema ships with the DDL here, and did not for 0026
 *
 * `migrate-order-line-snapshot.ts` deliberately carried raw DDL and no schema
 * change, because **Drizzle names every column of a schema in an `INSERT`** —
 * merely adding a column to `schema/orders.ts` makes order acceptance emit it
 * and fail every paid checkout against a database that does not have it.
 *
 * That hazard is specific to *adding a column to a table an existing writer
 * already touches*. These are new tables. No existing query names them, no
 * existing `.select()` expands to them, and `schema/index.ts` exporting them
 * changes not one statement any current code emits. So `schema/reviews.ts`,
 * `drizzle/0028_icy_sally_floyd.sql`, and its ledger row all travel together,
 * and the ordering rule that still binds is the deployment one above.
 *
 * ## The statements
 *
 * Literal content of `drizzle/0028_icy_sally_floyd.sql`, not re-derived from the
 * schema file, so this can never drift from what `drizzle-kit` actually
 * generated. `CREATE TABLE`/`CREATE INDEX` gain `IF NOT EXISTS` (Postgres
 * supports it for both); `CREATE TYPE` and `ALTER TABLE ... ADD CONSTRAINT` do
 * not support it, so those rely on the `duplicate_object` tolerance below.
 *
 * ## The real hazard is the lock, not the tables
 *
 * Creating a table is cheap. Adding its foreign keys is not: `ALTER TABLE ...
 * ADD CONSTRAINT ... FOREIGN KEY` takes a `SHARE ROW EXCLUSIVE` lock on the
 * **referenced** table, and three of the six references point at
 * `sals3_order_lines`, `sals3_orders`, and `products`. On the order tables that
 * means checkout acceptance queues behind it. The child tables are empty so
 * there is no scan, but a lock that cannot be acquired must fail fast rather
 * than hold the money path — hence a per-statement `lock_timeout`.
 *
 * `SET LOCAL` inside a per-statement transaction rather than a session `SET`:
 * this runs on a pooled serverless connection, and a session-level timeout
 * would leak onto whatever unrelated query reuses that connection next. One
 * transaction per statement rather than one for the whole run, so a timeout
 * partway through leaves every earlier statement applied and the run simply
 * resumable — each statement is individually idempotent.
 */
export const DDL_LOCK_TIMEOUT = '5s';

// Exported so tests derive the expected call count instead of hard-coding it.
export const DDL_STATEMENTS: string[] = [
  `CREATE TYPE "public"."product_review_reply_status" AS ENUM('PUBLISHED', 'SUPERSEDED')`,
  `CREATE TYPE "public"."product_review_status" AS ENUM('PUBLISHED', 'HIDDEN_BY_PLATFORM')`,
  `CREATE TABLE IF NOT EXISTS "sals3_product_review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"reply_version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"status" "product_review_reply_status" DEFAULT 'PUBLISHED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_product_review_replies_version_positive" CHECK ("sals3_product_review_replies"."reply_version" >= 1),
	CONSTRAINT "sals3_product_review_replies_body_length" CHECK (char_length("sals3_product_review_replies"."body") between 1 and 1000)
)`,
  `CREATE TABLE IF NOT EXISTS "sals3_product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_line_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"seller_account_id" uuid NOT NULL,
	"buyer_email" text NOT NULL,
	"display_name" text,
	"rating" smallint NOT NULL,
	"body" text,
	"status" "product_review_status" DEFAULT 'PUBLISHED' NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_product_reviews_rating_range" CHECK ("sals3_product_reviews"."rating" between 1 and 5),
	CONSTRAINT "sals3_product_reviews_body_length" CHECK ("sals3_product_reviews"."body" is null or char_length("sals3_product_reviews"."body") <= 1000),
	CONSTRAINT "sals3_product_reviews_display_name_length" CHECK ("sals3_product_reviews"."display_name" is null or char_length("sals3_product_reviews"."display_name") between 1 and 60),
	CONSTRAINT "sals3_product_reviews_buyer_email_lowercase" CHECK ("sals3_product_reviews"."buyer_email" = lower("sals3_product_reviews"."buyer_email"))
)`,
  `ALTER TABLE "sals3_product_review_replies" ADD CONSTRAINT "sals3_product_review_replies_review_id_sals3_product_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."sals3_product_reviews"("id") ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE "sals3_product_review_replies" ADD CONSTRAINT "sals3_product_review_replies_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_order_line_id_sals3_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sals3_order_lines"("id") ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_order_id_sals3_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sals3_orders"("id") ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sals3_product_review_replies_active_key" ON "sals3_product_review_replies" USING btree ("review_id") WHERE "sals3_product_review_replies"."status" = 'PUBLISHED'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sals3_product_review_replies_version_key" ON "sals3_product_review_replies" USING btree ("review_id","reply_version")`,
  `CREATE INDEX IF NOT EXISTS "sals3_product_review_replies_seller_idx" ON "sals3_product_review_replies" USING btree ("seller_account_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sals3_product_reviews_line_key" ON "sals3_product_reviews" USING btree ("order_line_id")`,
  `CREATE INDEX IF NOT EXISTS "sals3_product_reviews_product_idx" ON "sals3_product_reviews" USING btree ("product_id","status","created_at")`,
  `CREATE INDEX IF NOT EXISTS "sals3_product_reviews_seller_idx" ON "sals3_product_reviews" USING btree ("seller_account_id","created_at")`,
  `CREATE INDEX IF NOT EXISTS "sals3_product_reviews_buyer_idx" ON "sals3_product_reviews" USING btree ("buyer_email")`,
];

/** The tables this migration must leave in place, in `information_schema` terms. */
export const REVIEW_TABLE_NAMES = [
  'sals3_product_reviews',
  'sals3_product_review_replies',
] as const;

const ALREADY_EXISTS_CODES = new Set([
  '42710', // duplicate_object (types, constraints)
  '42P07', // duplicate_table
  '42701', // duplicate_column
]);

function isAlreadyExistsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === 'string' && ALREADY_EXISTS_CODES.has(code);
}

export type ExistingReviewTables = {
  productReviews: boolean;
  productReviewReplies: boolean;
};

/**
 * Read-only. Whether the tables are actually present, asked of the database
 * rather than inferred from the migration ledger — the ledger records intent,
 * this records reality, and the whole point of the PR #102 incident is that
 * those two can disagree.
 */
export async function readExistingReviewTables(
  db: Database,
): Promise<ExistingReviewTables> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('sals3_product_reviews', 'sals3_product_review_replies')`,
    ),
  )) as unknown as { table_name?: unknown }[];

  const present = new Set(
    rows
      .map((row) => row.table_name)
      .filter((name) => typeof name === 'string'),
  );

  return {
    productReviews: present.has('sals3_product_reviews'),
    productReviewReplies: present.has('sals3_product_review_replies'),
  };
}

export type RunReviewsDdlResult = {
  statementsRun: number;
  statementsSkippedAlreadyExists: number;
};

/**
 * Runs every DDL statement in order, each in its own transaction with a bounded
 * `lock_timeout`. A statement whose object already exists is skipped rather than
 * aborting the rest — that is what makes a second call over an already-migrated
 * environment a safe no-op instead of a hard failure partway through.
 *
 * A lock timeout is **not** tolerated: it aborts the run so the operator sees it
 * and retries when the database is quieter. Every earlier statement stays
 * applied and every statement is individually idempotent, so a retry resumes
 * rather than restarts.
 */
export async function runReviewsDdl(
  db: Database,
): Promise<RunReviewsDdlResult> {
  let statementsRun = 0;
  let statementsSkippedAlreadyExists = 0;

  // Ordered and sequential on purpose: the indexes and foreign keys depend on
  // the types and tables the earlier statements create.
  // eslint-disable-next-line no-restricted-syntax -- sequential by design, see above.
  for (const statement of DDL_STATEMENTS) {
    try {
      // eslint-disable-next-line no-await-in-loop -- ordered DDL, see above.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`),
        );
        await tx.execute(sql.raw(statement));
      });
      statementsRun += 1;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      statementsSkippedAlreadyExists += 1;
    }
  }

  return { statementsRun, statementsSkippedAlreadyExists };
}

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0028_icy_sally_floyd` (`when`)
 * and the sha256 of `drizzle/0028_icy_sally_floyd.sql`'s raw file content,
 * computed exactly the way `drizzle-orm`'s own `readMigrationFiles()` does it.
 * Hard-coded rather than read from disk at runtime: this endpoint must never
 * depend on the migration file being present in the deployed serverless bundle.
 * Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0028_icy_sally_floyd.sql').toString()).digest('hex'))"
 * if this migration is ever regenerated (only then). Pinned to the file by
 * `migrate-product-reviews.test.ts`.
 */
const MIGRATION_0028_CREATED_AT = 1787337923216;
const MIGRATION_0028_HASH =
  'fc4546010444b99132c20f167c84f5d2e343ca30d8047e53992bc4b58fbfbd12';

export type MarkMigration0028AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records `0028_icy_sally_floyd` as applied in `drizzle.__drizzle_migrations`,
 * so a later real `npm run db:migrate` against this database does not try to run
 * it again. Harmless if it did — every statement above tolerates existing
 * objects — but the ledger should stay a true history of what has actually been
 * applied.
 *
 * Idempotent by construction: only inserts when no row with this exact
 * `created_at` exists. Values are fixed constants, not request input, so the raw
 * SQL carries no injection risk.
 */
export async function markMigration0028Applied(
  db: Database,
): Promise<MarkMigration0028AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0028_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0028_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0028_HASH}', ${MIGRATION_0028_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0028_CREATED_AT, inserted: true };
}

export type MigrateProductReviewsResult = {
  ok: true;
  /** The tables' real state before this run. Both `true` means it was a no-op. */
  tablesExistedBefore: ExistingReviewTables;
  ddl: RunReviewsDdlResult;
  migrationRecord: MarkMigration0028AppliedResult;
  /**
   * Re-read from `information_schema` *after* the DDL. This is the field the
   * operator should trust: a 200 with a `false` in here would mean the run
   * reported success without achieving anything, which is the exact false
   * confidence this pattern exists to undo.
   */
  tablesExistAfter: ExistingReviewTables;
};

export async function migrateProductReviews(
  db: Database,
): Promise<MigrateProductReviewsResult> {
  const tablesExistedBefore = await readExistingReviewTables(db);
  const ddl = await runReviewsDdl(db);
  const migrationRecord = await markMigration0028Applied(db);
  const tablesExistAfter = await readExistingReviewTables(db);

  return {
    ok: true,
    tablesExistedBefore,
    ddl,
    migrationRecord,
    tablesExistAfter,
  };
}
