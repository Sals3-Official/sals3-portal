import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  categoryAttributeControls,
  categoryAttributeDictionary,
} from '@/lib/db/schema/category-attribute-controls';
import { sals3Categories } from '@/lib/db/schema/pricing-policy';
import attributeControlsExtract from '@/lib/db/seed-data/sals3-category-attribute-controls-v1.json';

/**
 * `drizzle/meta/_journal.json`'s entry for tag `0020_shocking_hedge_knight`
 * (`when`) and the sha256 of `drizzle/0020_shocking_hedge_knight.sql`'s raw
 * file content, computed exactly the way `drizzle-orm`'s own
 * `readMigrationFiles()` does it
 * (`crypto.createHash('sha256').update(fs.readFileSync(path).toString()).digest('hex')`
 * - see `node_modules/drizzle-orm/migrator.cjs`). Hard-coded rather than
 * read from disk at runtime so this endpoint never depends on the migration
 * file being present in the deployed serverless bundle. Re-derive with:
 *   node -e "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync('drizzle/0020_shocking_hedge_knight.sql').toString()).digest('hex'))"
 * if this migration is ever regenerated (only then - this value must never
 * change for the already-shipped 0020 migration).
 */
const MIGRATION_0020_CREATED_AT = 1786935292882;
const MIGRATION_0020_HASH =
  'ea5a5929e0f823e49518609ae3b3af315245ff38caa6eb0d4c183ed2f7b70d52';

/**
 * One-time, idempotent DDL + seed for the category-attribute-controls
 * feature (`category_attribute_dictionary`, `category_attribute_controls`,
 * `product_category_attribute_values`) - reachable only through
 * `/api/internal/catalog/taxonomy/migrate-attribute-controls`, same
 * break-glass pattern as `seed-v1.ts` (see
 * `sals3-session-2026-08-15-part48-taxonomy-v1-production-rollout-and-category-picker-ux`
 * in the sibling vault): `drizzle/0020_...sql` was applied and seeded
 * against a local database only, never against the deployed environment,
 * and `read-model.ts` queries these tables unconditionally on every
 * `/listings` load - the exact production incident that vault note
 * describes, one level earlier (missing tables, not just missing rows).
 *
 * DDL statements are the literal content of
 * `drizzle/0020_shocking_hedge_knight.sql`, not re-derived from the schema
 * file, so this can never drift from what `drizzle-kit` actually generated.
 * `CREATE TABLE`/`CREATE INDEX` use `IF NOT EXISTS` (Postgres supports it
 * for both); `CREATE TYPE` and `ALTER TABLE ... ADD CONSTRAINT` do not
 * support it, so those are wrapped to tolerate "already exists" (Postgres
 * `duplicate_object`/`42710`, `duplicate_table`/`42P07`) - safe to call this
 * function more than once, or against an environment that already has some
 * of this applied.
 */

// Exported so tests can derive `runAttributeControlsDdl`'s expected call
// count instead of hard-coding it.
export const DDL_STATEMENTS: string[] = [
  `CREATE TYPE "public"."attribute_aeo_geo_visibility" AS ENUM('ANSWER_SUMMARY_USEFUL', 'ATTRIBUTE_CONTEXT_ONLY')`,
  `CREATE TYPE "public"."attribute_compliance_review_flag" AS ENUM('STANDARD_CATALOG_REVIEW', 'WARRANTY_TERMS_COMPLIANCE', 'FOOD_SAFETY_REGISTRATION', 'REGULATED_HEALTH_SAFETY_CLAIM', 'EXPIRATION_AND_SHELF_LIFE', 'COSMETIC_REGULATORY_NOTIFICATION', 'VEHICLE_FITMENT_CRITICAL', 'CHILD_SAFETY_CERTIFICATION', 'LEGAL_IDENTIFIER_VERIFICATION', 'DIGITAL_LICENSE_VALIDATION', 'DIGITAL_DELIVERY_REVIEW')`,
  `CREATE TYPE "public"."attribute_data_type" AS ENUM('STRING', 'STRING_ARRAY')`,
  `CREATE TYPE "public"."attribute_input_control_type" AS ENUM('SINGLE_SELECT_DROPDOWN', 'MULTI_SELECT_DROPDOWN', 'TEXT_INPUT', 'NUMBER_INPUT', 'MEASUREMENT_INPUT', 'BOOLEAN_TOGGLE', 'DATE_PICKER')`,
  `CREATE TYPE "public"."attribute_requirement_level" AS ENUM('REQUIRED', 'RECOMMENDED', 'OPTIONAL')`,
  `CREATE TYPE "public"."attribute_seo_visibility" AS ENUM('PDP_VISIBLE', 'STRUCTURED_DATA_ELIGIBLE', 'ATTRIBUTE_CONTEXT_ONLY')`,
  `CREATE TABLE IF NOT EXISTS "category_attribute_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"controls_version" text NOT NULL,
	"attribute_name" text NOT NULL,
	"requirement_level" "attribute_requirement_level" NOT NULL,
	"input_control_type" "attribute_input_control_type" NOT NULL,
	"allowed_values" text[] DEFAULT '{}' NOT NULL,
	"allow_custom_value" boolean NOT NULL,
	"allow_multiple_values" boolean NOT NULL,
	"seller_help_text" text,
	"seo_visibility" "attribute_seo_visibility" NOT NULL,
	"aeo_geo_visibility" "attribute_aeo_geo_visibility" NOT NULL,
	"compliance_review_flag" "attribute_compliance_review_flag" NOT NULL,
	"source_basis" text,
	"source_workbook" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_checksum" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_attribute_controls_name_not_blank" CHECK (length(btrim("category_attribute_controls"."attribute_name")) > 0),
	CONSTRAINT "category_attribute_controls_allowed_values_match_type" CHECK (("category_attribute_controls"."input_control_type" in ('SINGLE_SELECT_DROPDOWN','MULTI_SELECT_DROPDOWN') and array_length("category_attribute_controls"."allowed_values", 1) > 0)
          or ("category_attribute_controls"."input_control_type" not in ('SINGLE_SELECT_DROPDOWN','MULTI_SELECT_DROPDOWN') and coalesce(array_length("category_attribute_controls"."allowed_values", 1), 0) = 0))
)`,
  `CREATE TABLE IF NOT EXISTS "category_attribute_dictionary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"controls_version" text NOT NULL,
	"attribute_name" text NOT NULL,
	"canonical_attribute_key" text NOT NULL,
	"default_input_control_type" "attribute_input_control_type" NOT NULL,
	"default_allowed_values" text[] DEFAULT '{}' NOT NULL,
	"default_allow_custom_value" boolean NOT NULL,
	"default_allow_multiple_values" boolean NOT NULL,
	"data_type" "attribute_data_type" NOT NULL,
	"notes" text,
	"source_workbook" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_checksum" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "product_category_attribute_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"attribute_name" text NOT NULL,
	"controls_version" text NOT NULL,
	"values" text[] DEFAULT '{}' NOT NULL,
	"is_custom_value" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "product_category_attribute_values_name_not_blank" CHECK (length(btrim("product_category_attribute_values"."attribute_name")) > 0)
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "category_attribute_controls_category_attribute_version_key" ON "category_attribute_controls" USING btree ("category_id","attribute_name","controls_version")`,
  `CREATE INDEX IF NOT EXISTS "category_attribute_controls_category_idx" ON "category_attribute_controls" USING btree ("category_id")`,
  `CREATE INDEX IF NOT EXISTS "category_attribute_controls_version_idx" ON "category_attribute_controls" USING btree ("controls_version")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "category_attribute_dictionary_name_version_key" ON "category_attribute_dictionary" USING btree ("attribute_name","controls_version")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "category_attribute_dictionary_key_version_key" ON "category_attribute_dictionary" USING btree ("canonical_attribute_key","controls_version")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "product_category_attribute_values_product_attribute_key" ON "product_category_attribute_values" USING btree ("product_id","attribute_name")`,
  `CREATE INDEX IF NOT EXISTS "product_category_attribute_values_product_idx" ON "product_category_attribute_values" USING btree ("product_id")`,
  `ALTER TABLE "category_attribute_controls" ADD CONSTRAINT "category_attribute_controls_category_id_sals3_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."sals3_categories"("id") ON DELETE restrict ON UPDATE no action`,
  `ALTER TABLE "category_attribute_controls" ADD CONSTRAINT "category_attribute_controls_attribute_name_controls_version_category_attribute_dictionary_attribute_name_controls_version_fk" FOREIGN KEY ("attribute_name","controls_version") REFERENCES "public"."category_attribute_dictionary"("attribute_name","controls_version") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "product_category_attribute_values" ADD CONSTRAINT "product_category_attribute_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action`,
];

/** Postgres error codes that mean "this object already exists" - the only ones this function tolerates. */
const ALREADY_EXISTS_CODES = new Set([
  '42710', // duplicate_object (types, constraints)
  '42P07', // duplicate_table
  '42701', // duplicate_column
]);

function isAlreadyExistsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;

  return typeof code === 'string' && ALREADY_EXISTS_CODES.has(code);
}

export type MigrateAttributeControlsDdlResult = {
  statementsRun: number;
  statementsSkippedAlreadyExists: number;
};

/**
 * Runs every DDL statement in order. A statement whose object already
 * exists is skipped rather than aborting the rest - this is what makes a
 * second call over an already-migrated environment a safe no-op instead of
 * a hard failure partway through.
 */
export async function runAttributeControlsDdl(
  db: Database,
): Promise<MigrateAttributeControlsDdlResult> {
  let statementsRun = 0;
  let statementsSkippedAlreadyExists = 0;

  // Ordered and sequential on purpose: later statements (indexes, foreign
  // keys) depend on the tables/types earlier ones create.
  // eslint-disable-next-line no-restricted-syntax
  for (const statement of DDL_STATEMENTS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.execute(sql.raw(statement));
      statementsRun += 1;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      statementsSkippedAlreadyExists += 1;
    }
  }

  return { statementsRun, statementsSkippedAlreadyExists };
}

export type MarkMigration0020AppliedResult = {
  createdAt: number;
  inserted: boolean;
};

/**
 * Records migration `0020_shocking_hedge_knight` as applied in
 * `drizzle.__drizzle_migrations`, the table `drizzle-orm`'s own migrator
 * reads/writes (see `node_modules/drizzle-orm/pg-core/dialect.cjs`). Without
 * this, a later `npm run db:migrate` against this database has no record of
 * 0020 and will try to run it again, failing on objects `runAttributeControlsDdl`
 * already created.
 *
 * Idempotent by construction: only inserts when no row with this exact
 * `created_at` exists yet, so calling this more than once never duplicates
 * the record. Values are fixed constants, not request input, so raw SQL
 * here carries no injection risk.
 */
export async function markMigration0020Applied(
  db: Database,
): Promise<MarkMigration0020AppliedResult> {
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
      `SELECT id FROM "drizzle"."__drizzle_migrations" WHERE created_at = ${MIGRATION_0020_CREATED_AT} LIMIT 1`,
    ),
  )) as unknown as unknown[];

  if (existing.length > 0) {
    return { createdAt: MIGRATION_0020_CREATED_AT, inserted: false };
  }

  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('${MIGRATION_0020_HASH}', ${MIGRATION_0020_CREATED_AT})`,
    ),
  );

  return { createdAt: MIGRATION_0020_CREATED_AT, inserted: true };
}

type DictionaryEntry = {
  attributeName: string;
  canonicalAttributeKey: string;
  defaultInputControlType: string;
  defaultAllowedValues: string[];
  defaultAllowCustomValue: boolean;
  defaultAllowMultipleValues: boolean;
  dataType: string;
  notes: string | null;
};

type ControlEntry = {
  categoryCode: string;
  attributeName: string;
  requirementLevel: string;
  inputControlType: string;
  allowedValues: string[];
  allowCustomValue: boolean;
  allowMultipleValues: boolean;
  sellerHelpText: string | null;
  seoVisibility: string;
  aeoGeoVisibility: string;
  complianceReviewFlag: string;
  sourceBasis: string | null;
};

type ExtractionOutput = {
  source: { workbook: string; sha256: string };
  controlsVersion: string;
  dictionary: DictionaryEntry[];
  controls: ControlEntry[];
};

const extract = attributeControlsExtract as unknown as ExtractionOutput;

/** How many missing category codes to echo back in a refusal - enough to diagnose, never the full list. */
const MISSING_CATEGORY_CODES_SAMPLE_SIZE = 20;

export type SeedAttributeControlsDataResult =
  | {
      ok: true;
      controlsVersion: string;
      dictionaryInExtract: number;
      dictionaryInserted: number;
      controlsInExtract: number;
      controlsInserted: number;
    }
  | {
      ok: false;
      reason: 'missing-category-codes';
      missingCategoryCodeCount: number;
      missingCategoryCodesSample: string[];
    };

/**
 * Additive-only seed of the frozen extraction into
 * `category_attribute_dictionary`/`category_attribute_controls`.
 * `onConflictDoNothing` on each table's natural unique key - safe to call
 * more than once, unlike `scripts/seed-category-attribute-controls.mts`
 * (which deliberately refuses a `controlsVersion` that already has rows,
 * appropriate for a CLI tool a person runs deliberately, not for a
 * break-glass endpoint that must tolerate being called twice).
 *
 * Never touches `sals3_categories`. If the extract references a category
 * code with no matching row, this fails closed - it inserts nothing into
 * either table - rather than silently seeding a partial data set that a
 * caller could mistake for a complete migration.
 */
export async function seedAttributeControlsData(
  db: Database,
): Promise<SeedAttributeControlsDataResult> {
  const categories = await db
    .select({ id: sals3Categories.id, code: sals3Categories.code })
    .from(sals3Categories);
  const categoryIdByCode = new Map(categories.map((row) => [row.code, row.id]));

  const missingCategoryCodes = [
    ...new Set(
      extract.controls
        .map((row) => row.categoryCode)
        .filter((code) => !categoryIdByCode.has(code)),
    ),
  ];

  if (missingCategoryCodes.length > 0) {
    return {
      ok: false,
      reason: 'missing-category-codes',
      missingCategoryCodeCount: missingCategoryCodes.length,
      missingCategoryCodesSample: missingCategoryCodes.slice(
        0,
        MISSING_CATEGORY_CODES_SAMPLE_SIZE,
      ),
    };
  }

  const dictionaryValues = extract.dictionary.map((entry) => ({
    controlsVersion: extract.controlsVersion,
    attributeName: entry.attributeName,
    canonicalAttributeKey: entry.canonicalAttributeKey,
    defaultInputControlType:
      entry.defaultInputControlType as (typeof categoryAttributeDictionary.$inferInsert)['defaultInputControlType'],
    defaultAllowedValues: entry.defaultAllowedValues,
    defaultAllowCustomValue: entry.defaultAllowCustomValue,
    defaultAllowMultipleValues: entry.defaultAllowMultipleValues,
    dataType:
      entry.dataType as (typeof categoryAttributeDictionary.$inferInsert)['dataType'],
    notes: entry.notes,
    sourceWorkbook: extract.source.workbook,
    sourceSheet: 'Attribute_Control_Dictionary',
    sourceChecksum: extract.source.sha256,
  }));

  const insertedDictionary = await db
    .insert(categoryAttributeDictionary)
    .values(dictionaryValues)
    .onConflictDoNothing({
      target: [
        categoryAttributeDictionary.attributeName,
        categoryAttributeDictionary.controlsVersion,
      ],
    })
    .returning({ id: categoryAttributeDictionary.id });

  const controlValues = extract.controls.map((row) => ({
    categoryId: categoryIdByCode.get(row.categoryCode)!,
    controlsVersion: extract.controlsVersion,
    attributeName: row.attributeName,
    requirementLevel:
      row.requirementLevel as (typeof categoryAttributeControls.$inferInsert)['requirementLevel'],
    inputControlType:
      row.inputControlType as (typeof categoryAttributeControls.$inferInsert)['inputControlType'],
    allowedValues: row.allowedValues,
    allowCustomValue: row.allowCustomValue,
    allowMultipleValues: row.allowMultipleValues,
    sellerHelpText: row.sellerHelpText,
    seoVisibility:
      row.seoVisibility as (typeof categoryAttributeControls.$inferInsert)['seoVisibility'],
    aeoGeoVisibility:
      row.aeoGeoVisibility as (typeof categoryAttributeControls.$inferInsert)['aeoGeoVisibility'],
    complianceReviewFlag:
      row.complianceReviewFlag as (typeof categoryAttributeControls.$inferInsert)['complianceReviewFlag'],
    sourceBasis: row.sourceBasis,
    sourceWorkbook: extract.source.workbook,
    sourceSheet: 'Category_Attribute_Controls',
    sourceChecksum: extract.source.sha256,
  }));

  const CHUNK = 500;
  let controlsInserted = 0;

  // A counting `for`, not `for-of`: matches this codebase's existing
  // `no-restricted-syntax` posture in `scripts/seed-*.mts`.
  for (let index = 0; index < controlValues.length; index += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    const written = await db
      .insert(categoryAttributeControls)
      .values(controlValues.slice(index, index + CHUNK))
      .onConflictDoNothing({
        target: [
          categoryAttributeControls.categoryId,
          categoryAttributeControls.attributeName,
          categoryAttributeControls.controlsVersion,
        ],
      })
      .returning({ id: categoryAttributeControls.id });

    controlsInserted += written.length;
  }

  return {
    ok: true,
    controlsVersion: extract.controlsVersion,
    dictionaryInExtract: extract.dictionary.length,
    dictionaryInserted: insertedDictionary.length,
    controlsInExtract: extract.controls.length,
    controlsInserted,
  };
}

export type MigrateAttributeControlsResult =
  | {
      ok: true;
      ddl: MigrateAttributeControlsDdlResult;
      migrationRecord: MarkMigration0020AppliedResult;
      seed: Extract<SeedAttributeControlsDataResult, { ok: true }>;
    }
  | Extract<SeedAttributeControlsDataResult, { ok: false }>;

/**
 * Orchestrates the full break-glass run in the order that matters: DDL, then
 * marking `0020` applied, then the seed. Each step is a plain sequential
 * `await` with no `try`/`catch` swallowing in between, so if the DDL or the
 * migration-record step throws, this function throws too and the seed step
 * below it never runs - a caller does not need to re-implement that
 * ordering guarantee.
 */
export async function migrateAttributeControls(
  db: Database,
): Promise<MigrateAttributeControlsResult> {
  const ddl = await runAttributeControlsDdl(db);
  const migrationRecord = await markMigration0020Applied(db);
  const seed = await seedAttributeControlsData(db);

  if (!seed.ok) return seed;

  return { ok: true, ddl, migrationRecord, seed };
}
