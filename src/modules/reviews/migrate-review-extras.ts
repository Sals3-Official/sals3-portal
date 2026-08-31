import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * One-time, idempotent DDL for the three things Jay's review comments need: a
 * **delivery rating** on `sals3_product_reviews`, a
 * `sals3_product_review_flags` table so a buyer can ask a moderator to look at
 * a review, and a `sals3_product_review_photos` table so a review can carry
 * pictures.
 *
 * Reachable only through `/api/internal/reviews/migrate-review-extras`, the
 * break-glass pattern `migrate-product-reviews.ts` and
 * `migrate-order-line-snapshot.ts` established: `npm run db:migrate` is only
 * ever safe against a local database (`scripts/guard-remote-db.mts` refuses
 * anything else by design), so the deployed environment needs its own
 * authenticated path to apply DDL and no raw production `DATABASE_URL` is ever
 * handled on a laptop.
 *
 * **This must run before the deployment that reads or writes any of them.**
 *
 * ## Why this ships with no Drizzle schema change at all
 *
 * Two of the three are new tables, which are harmless to declare early. The
 * third is not: `delivery_rating` is a **column on a table an existing writer
 * already inserts into**, and Drizzle names every column of a schema in an
 * `INSERT`. Merely adding `deliveryRating` to `schema/reviews.ts` would make
 * `submitReview` emit `insert into sals3_product_reviews (...,
 * "delivery_rating", ...)` and fail every buyer review against a database that
 * does not have it — the exact mechanism `migrate-order-line-snapshot.ts`
 * documents, and the exact mechanism that took the Product Catalogue down in
 * PR #102 and again in PR #113.
 *
 * The three could have been split into "safe now" and "hazardous", but a
 * migration whose halves can be applied independently is a migration somebody
 * applies half of. They travel together, behind the rule the hazardous one
 * imposes: raw DDL here, no schema column, no `drizzle/` migration file, no
 * ledger entry. All of those enter in the change that adds the code reading
 * them, which deploys only after a run here reports `presentAfter` fully true.
 *
 * ## The real hazard is the lock, not the objects
 *
 * `ALTER TABLE ... ADD COLUMN` takes an `ACCESS EXCLUSIVE` lock on
 * `sals3_product_reviews`, and each foreign key below takes a
 * `SHARE ROW EXCLUSIVE` on the **referenced** table — which is that same
 * reviews table. Nothing on the money path references it, so the blast radius
 * is the review surfaces rather than checkout, but a lock that cannot be
 * acquired must still fail fast rather than queue the product page behind DDL.
 *
 * Hence a per-statement `lock_timeout`, `SET LOCAL` inside a per-statement
 * transaction rather than a session `SET`: this runs on a pooled serverless
 * connection and a session-level timeout would leak onto whatever unrelated
 * query reuses that connection next. One transaction per statement rather than
 * one for the whole run, so a timeout partway through leaves every earlier
 * statement applied and the run simply resumable — each statement is
 * individually idempotent.
 */
export const DDL_LOCK_TIMEOUT = '5s';

/**
 * The statements, in dependency order: types, then tables, then foreign keys,
 * then indexes.
 *
 * ## Why the delivery score is a nullable column and not `NOT NULL DEFAULT 0`
 *
 * A buyer may score the item and skip the delivery, and an absent delivery
 * score must never be counted as zero — for the same reason an unreviewed
 * product does not render "0.0 out of 5". A nought is a verdict, and no verdict
 * was given. `NULL` is the only value that says "not answered" without also
 * saying "answered badly", and every read of this column is required to exclude
 * it from the average rather than fold it in.
 *
 * Every existing review predates the question entirely, so they all start
 * `NULL` — correct rather than merely convenient.
 *
 * ## Why a flag carries a reporter and a unique index on them
 *
 * `sals3_product_review_flags_reporter_key` is the abuse model, the same way
 * `sals3_product_reviews_line_key` is for reviews. Without it one person files
 * a hundred reports against a rating they dislike and the queue reads as
 * consensus. With it, a report costs a distinct signed-in buyer, and the count
 * a moderator sees is a count of people.
 *
 * `resolution` lives on the flag rather than only on the review because the
 * report and the decision are different facts: the review's own `status` is
 * what the storefront reads, and these rows are the record of who asked and
 * what was answered. `..._resolution_stamped` keeps the two halves of the
 * decision from drifting apart — a resolved flag with no timestamp, or an open
 * one carrying a decision date, is a row nobody can audit.
 *
 * ## Why photos are a table and not a `jsonb` column
 *
 * The same reason the flags are: `position` needs a unique index to make the
 * order a fact rather than an array's accident, and a moderator has to be able
 * to reach one photo without rewriting the review row that holds the rest.
 */
export const DDL_STATEMENTS: string[] = [
  `ALTER TABLE "sals3_product_reviews" ADD COLUMN IF NOT EXISTS "delivery_rating" smallint`,
  `ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_delivery_rating_range" CHECK ("sals3_product_reviews"."delivery_rating" is null or "sals3_product_reviews"."delivery_rating" between 1 and 5)`,

  `CREATE TYPE "public"."product_review_flag_reason" AS ENUM('OFF_TOPIC', 'OFFENSIVE', 'SPAM', 'PERSONAL_INFORMATION', 'NOT_A_REVIEW')`,
  `CREATE TYPE "public"."product_review_flag_resolution" AS ENUM('OPEN', 'HIDDEN', 'KEPT')`,

  `CREATE TABLE IF NOT EXISTS "sals3_product_review_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"reporter_email" text NOT NULL,
	"reason" "product_review_flag_reason" NOT NULL,
	"resolution" "product_review_flag_resolution" DEFAULT 'OPEN' NOT NULL,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_product_review_flags_reporter_email_lowercase" CHECK ("sals3_product_review_flags"."reporter_email" = lower("sals3_product_review_flags"."reporter_email")),
	CONSTRAINT "sals3_product_review_flags_resolution_stamped" CHECK (("sals3_product_review_flags"."resolution" = 'OPEN') = ("sals3_product_review_flags"."resolved_at" is null))
)`,

  `CREATE TABLE IF NOT EXISTS "sals3_product_review_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"checksum" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width_pixels" integer NOT NULL,
	"height_pixels" integer NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_product_review_photos_position_range" CHECK ("sals3_product_review_photos"."position" between 0 and 3),
	CONSTRAINT "sals3_product_review_photos_dimensions_positive" CHECK ("sals3_product_review_photos"."width_pixels" > 0 and "sals3_product_review_photos"."height_pixels" > 0),
	CONSTRAINT "sals3_product_review_photos_byte_size_positive" CHECK ("sals3_product_review_photos"."byte_size" > 0)
)`,

  `ALTER TABLE "sals3_product_review_flags" ADD CONSTRAINT "sals3_product_review_flags_review_id_sals3_product_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."sals3_product_reviews"("id") ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE "sals3_product_review_photos" ADD CONSTRAINT "sals3_product_review_photos_review_id_sals3_product_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."sals3_product_reviews"("id") ON DELETE restrict ON UPDATE no action`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "sals3_product_review_flags_reporter_key" ON "sals3_product_review_flags" USING btree ("review_id","reporter_email")`,
  `CREATE INDEX IF NOT EXISTS "sals3_product_review_flags_queue_idx" ON "sals3_product_review_flags" USING btree ("resolution","created_at")`,
  `CREATE INDEX IF NOT EXISTS "sals3_product_review_flags_review_idx" ON "sals3_product_review_flags" USING btree ("review_id")`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "sals3_product_review_photos_position_key" ON "sals3_product_review_photos" USING btree ("review_id","position")`,
  `CREATE INDEX IF NOT EXISTS "sals3_product_review_photos_review_idx" ON "sals3_product_review_photos" USING btree ("review_id")`,
];

const ALREADY_EXISTS_CODES = new Set([
  '42710', // duplicate_object (types, constraints)
  '42P07', // duplicate_table
  '42701', // duplicate_column
]);

function isAlreadyExistsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === 'string' && ALREADY_EXISTS_CODES.has(code);
}

export type ReviewExtrasPresence = {
  deliveryRatingColumn: boolean;
  flagsTable: boolean;
  photosTable: boolean;
};

/**
 * Read-only. Whether the three objects are actually present, asked of the
 * database rather than inferred from the migration ledger — the ledger records
 * intent, this records reality, and the whole point of the PR #102 incident is
 * that those two can disagree.
 */
export async function readReviewExtrasPresence(
  db: Database,
): Promise<ReviewExtrasPresence> {
  const tableRows = (await db.execute(
    sql.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('sals3_product_review_flags', 'sals3_product_review_photos')`,
    ),
  )) as unknown as { table_name?: unknown }[];

  const columnRows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'sals3_product_reviews'
         AND column_name = 'delivery_rating'
       LIMIT 1`,
    ),
  )) as unknown as unknown[];

  const present = new Set(
    tableRows
      .map((row) => row.table_name)
      .filter((name) => typeof name === 'string'),
  );

  return {
    deliveryRatingColumn: columnRows.length > 0,
    flagsTable: present.has('sals3_product_review_flags'),
    photosTable: present.has('sals3_product_review_photos'),
  };
}

export type RunReviewExtrasDdlResult = {
  statementsRun: number;
  statementsSkippedAlreadyExists: number;
};

/**
 * Runs every statement in order, each in its own transaction with a bounded
 * `lock_timeout`. A statement whose object already exists is skipped rather
 * than aborting the rest — that is what makes a second call over an
 * already-migrated environment a safe no-op instead of a hard failure partway
 * through.
 *
 * A lock timeout is **not** tolerated: it aborts the run so the operator sees
 * it and retries when the database is quieter. Every earlier statement stays
 * applied and every statement is individually idempotent, so a retry resumes
 * rather than restarts.
 */
export async function runReviewExtrasDdl(
  db: Database,
): Promise<RunReviewExtrasDdlResult> {
  let statementsRun = 0;
  let statementsSkippedAlreadyExists = 0;

  // Ordered and sequential on purpose: the tables depend on the types, and the
  // foreign keys and indexes depend on the tables.
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

export type MigrateReviewExtrasResult = {
  ok: true;
  /** Real state before this run. All three `true` means it was a no-op. */
  presentBefore: ReviewExtrasPresence;
  ddl: RunReviewExtrasDdlResult;
  /**
   * Re-read from `information_schema` *after* the DDL. This is the field the
   * operator should trust: a 200 with a `false` in here would mean the run
   * reported success without achieving anything, which is the exact false
   * confidence this pattern exists to undo.
   */
  presentAfter: ReviewExtrasPresence;
};

export async function migrateReviewExtras(
  db: Database,
): Promise<MigrateReviewExtrasResult> {
  const presentBefore = await readReviewExtrasPresence(db);
  const ddl = await runReviewExtrasDdl(db);
  const presentAfter = await readReviewExtrasPresence(db);

  return { ok: true, presentBefore, ddl, presentAfter };
}
