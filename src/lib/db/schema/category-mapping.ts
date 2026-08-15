import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { supplierCandidates, supplierEnum } from './catalog';
import { sals3Categories } from './pricing-policy';

/**
 * CJ-to-Sals3 category mapping pilot (ADR-002 §3) plus the Sals3 Taxonomy v1
 * form presets the mapping unlocks (ADR-002 §4).
 *
 * Three deliberate boundaries:
 *
 * 1. **No second taxonomy.** `sals3_categories` (declared in
 *    `pricing-policy.ts`, seeded by `scripts/seed-sals3-taxonomy-v1.mts`) is
 *    already the one Sals3-side category identity, and its `code` column is
 *    already the only thing a commercial policy may reference. Nothing here
 *    re-declares a category; `sals3_category_presets` hangs the workbook's
 *    variation/attribute/SKU metadata off that existing identity, and the
 *    mapping table points at it by foreign key.
 * 2. **The supplier identity is the external id, not the path.** A CJ
 *    category *name/path* is display text that CJ can reword; the stable
 *    external `categoryId` is the identity. `observedCategoryPath` is kept
 *    as a source snapshot that explains a decision to a reviewer — it is
 *    never matched on, and no name-similarity/fuzzy method exists as an
 *    enum value, so an uncontrolled text match cannot become an active rule.
 * 3. **Absence is a real answer.** Where no owner-approved rule exists there
 *    is simply no active row, and the resolver says `UNMAPPED`. A guessed
 *    category is never stored, and the `mapping_target_matches_confidence`
 *    check below makes "confident but pointing nowhere" and "uncertain but
 *    pointing somewhere" both unrepresentable in the database, not merely
 *    discouraged in application code.
 */

/**
 * Which taxonomy extraction a preset/mapping row belongs to. A string rather
 * than an enum so publishing Taxonomy v1 is a data change, not a migration —
 * ADR-002 keeps every branch's status (`adopted`/`pilot_validated`/
 * `production_ready`) on `sals3_categories.taxonomy_status`, and this column
 * answers the separate question "which extraction of the workbook is this".
 */
export const ACTIVE_TAXONOMY_VERSION = 'sals3-taxonomy-v1';

/**
 * Sals3 Taxonomy v1 form presets, seeded verbatim from the
 * `Universal_Category_Taxonomy` sheet's `Variation Architecture`,
 * `Tier 1/2 Attribute`, `SKU Format Standard`, `Required Item Attributes`,
 * `Store Catalogue Status`, and `Product Examples & Guidelines` columns —
 * see `src/lib/db/seed-data/sals3-taxonomy-presets-v1.json` and
 * `scripts/seed-sals3-taxonomy-v1.mts`.
 *
 * Separate from `sals3_categories` on purpose. The category *code* is a
 * stable identity that policy and history reference forever; these presets
 * are reference metadata that ADR-002 §4 explicitly says must be validated
 * branch by branch and will change. Keying them by
 * `(category_id, taxonomy_version)` lets a corrected extraction land beside
 * the old one instead of overwriting the row a past decision was made from.
 *
 * `sourceWorkbook`/`sourceChecksum`/`importedAt` carry the provenance
 * ADR-002 §2 requires. They record where the values came from; they do not
 * assert that the licensing/reuse question ADR-002 leaves open is settled.
 */
export const sals3CategoryPresets = pgTable(
  'sals3_category_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => sals3Categories.id, { onDelete: 'restrict' }),
    taxonomyVersion: text('taxonomy_version').notNull(),

    /** Workbook value verbatim, e.g. `2-Tier (Color + Size)`. Parsed by an allow list, never by guesswork — see `modules/catalog/taxonomy/category-form.ts`. */
    variationArchitecture: text('variation_architecture'),
    tier1Attribute: text('tier_1_attribute'),
    tier2Attribute: text('tier_2_attribute'),
    skuFormatStandard: text('sku_format_standard'),

    /** Split from the workbook's comma-separated cell. `requiredItemAttributesRaw` keeps the original string so the split is auditable. */
    requiredItemAttributes: text('required_item_attributes')
      .array()
      .notNull()
      .default([]),
    requiredItemAttributesRaw: text('required_item_attributes_raw'),

    /** Workbook `Store Catalogue Status` — provenance about the source sheet, NOT a Sals3 listing state. */
    storeCatalogueStatus: text('store_catalogue_status'),
    /** Blank in all but a handful of records; ADR-002 forbids using it as a primary classifier input. */
    productExamples: text('product_examples'),

    sourceWorkbook: text('source_workbook').notNull(),
    sourceSheet: text('source_sheet').notNull(),
    sourceChecksum: text('source_checksum').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('sals3_category_presets_category_version_key').on(
      table.categoryId,
      table.taxonomyVersion,
    ),
    index('sals3_category_presets_version_idx').on(table.taxonomyVersion),
  ],
);

/**
 * ADR-002 §3's four confidence states, spelled in this codebase's existing
 * uppercase convention. Identical in meaning and order to the
 * `CategoryMappingConfidence` union `modules/pricing/types.ts` already
 * refuses to price on — this table is where that value finally comes from
 * instead of a Product Editor fixture.
 *
 * Declared here rather than in `product-catalog.ts`, where it was originally
 * introduced, because this is the module that owns the concept: a mapping
 * row *decides* a confidence, a `products` row only *records* the one it was
 * given. One Postgres type serves both, so the product's stored value and
 * the mapping that produced it can never drift into two vocabularies.
 * `product-catalog.ts` imports it, and the direction of that import is the
 * direction the data actually flows.
 */
export const categoryMappingConfidenceEnum = pgEnum(
  'category_mapping_confidence',
  ['EXACT', 'ACCEPTABLE', 'AMBIGUOUS', 'UNMAPPED'],
);

/**
 * How a rule was arrived at. Both values are deliberate, reviewed decisions:
 * `EXTERNAL_ID_RULE` keys on CJ's stable category id, `REVIEWED_PATH_RULE`
 * records that a human read the observed path and decided. There is
 * intentionally no `NAME_SIMILARITY`/`FUZZY`/`INFERRED` member — an
 * uncontrolled text match must not be expressible as an active mapping
 * method, so the database rejects it rather than a code review having to
 * catch it.
 */
export const providerCategoryMappingMethodEnum = pgEnum(
  'provider_category_mapping_method',
  ['EXTERNAL_ID_RULE', 'REVIEWED_PATH_RULE'],
);

export const providerCategoryMappingReviewStatusEnum = pgEnum(
  'provider_category_mapping_review_status',
  ['PENDING_REVIEW', 'APPROVED', 'REJECTED'],
);

/**
 * Lifecycle, kept distinct from review outcome. A row can be `APPROVED` and
 * still not be the one in force (`SUPERSEDED`), and a `PROPOSED` row is
 * inert. The `active_requires_approval` check below is what stops the two
 * from drifting apart.
 */
export const providerCategoryMappingStatusEnum = pgEnum(
  'provider_category_mapping_status',
  ['PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED'],
);

export const providerCategoryMappings = pgTable(
  'provider_category_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** The real provider code, reusing the existing `supplier` enum — not a free-text vendor name. */
    provider: supplierEnum('provider').notNull(),
    /** CJ's stable category id. The primary supplier-category identity. */
    externalCategoryId: text('external_category_id').notNull(),
    /** Source snapshot that explains the decision. Never matched on. */
    observedCategoryPath: text('observed_category_path'),

    /** `NULL` for `AMBIGUOUS`/`UNMAPPED` — see `mapping_target_matches_confidence`. */
    sals3CategoryId: uuid('sals3_category_id').references(
      () => sals3Categories.id,
      { onDelete: 'restrict' },
    ),
    taxonomyVersion: text('taxonomy_version').notNull(),

    /**
     * Monotonic per `(provider, external_category_id)`. Unique across every
     * status, so a retried proposal collides instead of forking history, and
     * so a persisted decision can always name the exact version it used.
     */
    mappingVersion: integer('mapping_version').notNull().default(1),
    /** The version this one replaced. `null` for the first. */
    supersedesId: uuid('supersedes_id'),

    method: providerCategoryMappingMethodEnum('method').notNull(),
    confidence: categoryMappingConfidenceEnum('confidence').notNull(),
    reviewStatus: providerCategoryMappingReviewStatusEnum('review_status')
      .notNull()
      .default('PENDING_REVIEW'),
    status: providerCategoryMappingStatusEnum('status')
      .notNull()
      .default('PROPOSED'),

    /** Required justification. `evidenceReference` points at the source that backs it (a CJ category-tree export, a review ticket). */
    reason: text('reason').notNull(),
    evidenceReference: text('evidence_reference'),

    actorId: text('actor_id').notNull(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /** ADR-002's "one rule in force at a time", enforced by Postgres rather than by convention. */
    uniqueIndex('provider_category_mappings_active_key')
      .on(table.provider, table.externalCategoryId)
      .where(sql`${table.status} = 'ACTIVE'`),
    /**
     * Version integrity *and* the identity lookup: history reads
     * (`listMappingHistory`) are served by this index's leading
     * `(provider, external_category_id)` columns, so no separate identity
     * index is carried — one fewer index to maintain on every write.
     */
    uniqueIndex('provider_category_mappings_version_key').on(
      table.provider,
      table.externalCategoryId,
      table.mappingVersion,
    ),
    /** Supports "which supplier categories point at this Sals3 category". */
    index('provider_category_mappings_category_idx').on(table.sals3CategoryId),
    check(
      'provider_category_mappings_external_id_not_blank',
      sql`length(btrim(${table.externalCategoryId})) > 0`,
    ),
    check(
      'provider_category_mappings_version_positive',
      sql`${table.mappingVersion} >= 1`,
    ),
    /**
     * A confident mapping must name a category; an uncertain one must not.
     * Without this, "AMBIGUOUS but here is a category anyway" would exist in
     * the table and some future caller would read the id without reading the
     * confidence.
     */
    check(
      'provider_category_mappings_target_matches_confidence',
      sql`(${table.confidence} in ('EXACT','ACCEPTABLE') and ${table.sals3CategoryId} is not null)
          or (${table.confidence} in ('AMBIGUOUS','UNMAPPED') and ${table.sals3CategoryId} is null)`,
    ),
    /** Nothing reaches `ACTIVE` without an explicit approval decision on the same row. */
    check(
      'provider_category_mappings_active_requires_approval',
      sql`${table.status} <> 'ACTIVE' or ${table.reviewStatus} = 'APPROVED'`,
    ),
  ],
);

export const categoryRemapReviewStatusEnum = pgEnum(
  'category_remap_review_status',
  ['OPEN', 'RESOLVED', 'DISMISSED'],
);

/**
 * ADR-002 §3: "Corrections update the mapping version and create an auditable
 * remap job for affected drafts or products."
 *
 * This is deliberately a *finding*, not a job: no worker, no outbox, no
 * queue, no automatic re-decision. Writing one never touches a candidate row,
 * its evaluation, its snapshot, or any audit row — a correction changes what
 * the mapping means going forward and leaves every historical record exactly
 * as it was. The durable worker that would act on these is reported as
 * deferred rather than half-built, because the only outbox pattern in this
 * repository belongs to the concurrent discovery work.
 *
 * `supplierCandidateId` is **nullable, and null today**, which is the honest
 * shape rather than a placeholder. Naming the affected candidates requires a
 * stable provider category id persisted on `supplier_candidates`, and this
 * branch has none: the table records only `external_product_id`, and
 * `candidate_evaluations.feed_snapshot` carries a category *name* string —
 * matching on which is exactly what the rest of this module refuses to do.
 * So a correction writes one summary row per superseded mapping with
 * `affectedCandidatesEnumerated = false`, saying plainly that the blast
 * radius is recorded but not yet enumerated. When the concurrent lean-catalog
 * work lands `supplier_candidates.provider_category_id`, per-candidate rows
 * are added to this same table with no migration and the flag flips — see
 * `governance.ts`.
 */
export const categoryRemapReviewFindings = pgTable(
  'category_remap_review_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null on a summary row; set once affected candidates can be enumerated. */
    supplierCandidateId: uuid('supplier_candidate_id').references(
      () => supplierCandidates.id,
      { onDelete: 'restrict' },
    ),
    /** False means "this correction's blast radius is recorded, not listed". Never rendered as "nothing was affected". */
    affectedCandidatesEnumerated: boolean('affected_candidates_enumerated')
      .notNull()
      .default(false),

    provider: supplierEnum('provider').notNull(),
    externalCategoryId: text('external_category_id').notNull(),

    previousMappingId: uuid('previous_mapping_id')
      .notNull()
      .references(() => providerCategoryMappings.id, { onDelete: 'restrict' }),
    previousMappingVersion: integer('previous_mapping_version').notNull(),
    /** `null` when the correction left the identity with no active mapping at all. */
    newMappingId: uuid('new_mapping_id').references(
      () => providerCategoryMappings.id,
      { onDelete: 'restrict' },
    ),
    newMappingVersion: integer('new_mapping_version'),

    status: categoryRemapReviewStatusEnum('status').notNull().default('OPEN'),
    reason: text('reason').notNull(),
    actorId: text('actor_id').notNull(),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * Idempotent retry, in two parts because Postgres treats NULLs as
     * distinct: the first covers future per-candidate rows, the second makes
     * the one summary row per superseded mapping genuinely unique.
     */
    uniqueIndex('category_remap_review_findings_candidate_previous_key').on(
      table.supplierCandidateId,
      table.previousMappingId,
    ),
    uniqueIndex('category_remap_review_findings_summary_key')
      .on(table.previousMappingId)
      .where(sql`${table.supplierCandidateId} is null`),
    index('category_remap_review_findings_open_idx')
      .on(table.provider, table.externalCategoryId)
      .where(sql`${table.status} = 'OPEN'`),
  ],
);

export type CategoryMappingConfidence =
  (typeof categoryMappingConfidenceEnum.enumValues)[number];
export type ProviderCategoryMappingMethod =
  (typeof providerCategoryMappingMethodEnum.enumValues)[number];
export type ProviderCategoryMappingReviewStatus =
  (typeof providerCategoryMappingReviewStatusEnum.enumValues)[number];
export type ProviderCategoryMappingStatus =
  (typeof providerCategoryMappingStatusEnum.enumValues)[number];
export type CategoryRemapReviewStatus =
  (typeof categoryRemapReviewStatusEnum.enumValues)[number];

export type Sals3CategoryPresetRow = typeof sals3CategoryPresets.$inferSelect;
export type NewSals3CategoryPresetRow =
  typeof sals3CategoryPresets.$inferInsert;
export type ProviderCategoryMappingRow =
  typeof providerCategoryMappings.$inferSelect;
export type NewProviderCategoryMappingRow =
  typeof providerCategoryMappings.$inferInsert;
export type CategoryRemapReviewFindingRow =
  typeof categoryRemapReviewFindings.$inferSelect;
