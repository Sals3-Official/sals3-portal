import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { sals3Categories } from './pricing-policy';

/**
 * Category-driven attribute controls (dropdowns, multi-selects, text/number/
 * measurement/boolean/date fields, requirement levels, seller help text,
 * SEO/AEO/GEO visibility) extracted from the finalized taxonomy workbook's
 * `Category_Attribute_Controls` and `Attribute_Control_Dictionary` sheets —
 * see `scripts/extract-category-attribute-controls.mts` and
 * `src/lib/db/seed-data/sals3-category-attribute-controls-v1.json`.
 *
 * Three deliberate boundaries, same posture as `category-mapping.ts`:
 *
 * 1. **No second taxonomy.** `sals3_categories` (declared in
 *    `pricing-policy.ts`) is still the one category identity. Nothing here
 *    persists `Category Path`/L1-L5 a second time - both are reachable via
 *    `categoryId` and the extraction script cross-checks the workbook's own
 *    pre-joined path against the live table before discarding it.
 * 2. **Independently versioned from the category tree.** `controlsVersion`
 *    is a free-text string, deliberately not the same axis as
 *    `sals3_category_presets.taxonomyVersion` / `ACTIVE_TAXONOMY_VERSION`:
 *    the category hierarchy is locked, but attribute controls are expected
 *    to be revised (the workbook's own Cleanup Notes recommend further
 *    business review of regulated categories). A corrected extraction lands
 *    beside the old one under a new version string rather than overwriting
 *    the row a past decision was made from - identical reasoning to
 *    `sals3_category_presets`'s own doc comment.
 * 3. **Dropdowns have allowed values, non-dropdowns don't - enforced by
 *    Postgres, not just by the extraction script.** This invariant holds for
 *    100% of the 53,625 source rows; the CHECK constraint below makes a
 *    future violation a write-time error instead of a silent data-quality
 *    regression.
 */

export const ACTIVE_ATTRIBUTE_CONTROLS_VERSION = 'sals3-attribute-controls-v1';

/**
 * Seven members for forward compatibility with the owner's brief even though
 * today's extraction only produces four (`SINGLE_SELECT_DROPDOWN`,
 * `MULTI_SELECT_DROPDOWN`, `TEXT_INPUT`, `MEASUREMENT_INPUT`) - confirmed by
 * `--discover-enums` against the live workbook. `NUMBER_INPUT`/
 * `BOOLEAN_TOGGLE`/`DATE_PICKER` are real, allow-listed members a future
 * `controlsVersion` can use with no schema change.
 */
export const attributeInputControlTypeEnum = pgEnum(
  'attribute_input_control_type',
  [
    'SINGLE_SELECT_DROPDOWN',
    'MULTI_SELECT_DROPDOWN',
    'TEXT_INPUT',
    'NUMBER_INPUT',
    'MEASUREMENT_INPUT',
    'BOOLEAN_TOGGLE',
    'DATE_PICKER',
  ],
);

export const attributeRequirementLevelEnum = pgEnum(
  'attribute_requirement_level',
  ['REQUIRED', 'RECOMMENDED', 'OPTIONAL'],
);

export const attributeSeoVisibilityEnum = pgEnum('attribute_seo_visibility', [
  'PDP_VISIBLE',
  'STRUCTURED_DATA_ELIGIBLE',
  'ATTRIBUTE_CONTEXT_ONLY',
]);

export const attributeAeoGeoVisibilityEnum = pgEnum(
  'attribute_aeo_geo_visibility',
  ['ANSWER_SUMMARY_USEFUL', 'ATTRIBUTE_CONTEXT_ONLY'],
);

/** Exact 11 distinct values confirmed against the live workbook via `--discover-enums`. */
export const attributeComplianceReviewFlagEnum = pgEnum(
  'attribute_compliance_review_flag',
  [
    'STANDARD_CATALOG_REVIEW',
    'WARRANTY_TERMS_COMPLIANCE',
    'FOOD_SAFETY_REGISTRATION',
    'REGULATED_HEALTH_SAFETY_CLAIM',
    'EXPIRATION_AND_SHELF_LIFE',
    'COSMETIC_REGULATORY_NOTIFICATION',
    'VEHICLE_FITMENT_CRITICAL',
    'CHILD_SAFETY_CERTIFICATION',
    'LEGAL_IDENTIFIER_VERIFICATION',
    'DIGITAL_LICENSE_VALIDATION',
    'DIGITAL_DELIVERY_REVIEW',
  ],
);

/** Exact 2 distinct values confirmed against the live workbook via `--discover-enums`. */
export const attributeDataTypeEnum = pgEnum('attribute_data_type', [
  'STRING',
  'STRING_ARRAY',
]);

/**
 * The 149-entry canonical dictionary (`Attribute_Control_Dictionary`), global
 * reference data - not per category. `category_attribute_controls` below has
 * a composite FK into this table so "every attribute name used by a control
 * row exists in the dictionary" (already true of all 53,625 source rows) is
 * a database invariant, not just an extraction-time assertion.
 */
export const categoryAttributeDictionary = pgTable(
  'category_attribute_dictionary',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    controlsVersion: text('controls_version').notNull(),
    attributeName: text('attribute_name').notNull(),
    canonicalAttributeKey: text('canonical_attribute_key').notNull(),
    defaultInputControlType: attributeInputControlTypeEnum(
      'default_input_control_type',
    ).notNull(),
    defaultAllowedValues: text('default_allowed_values')
      .array()
      .notNull()
      .default([]),
    defaultAllowCustomValue: boolean('default_allow_custom_value').notNull(),
    defaultAllowMultipleValues: boolean(
      'default_allow_multiple_values',
    ).notNull(),
    dataType: attributeDataTypeEnum('data_type').notNull(),
    notes: text('notes'),
    sourceWorkbook: text('source_workbook').notNull(),
    sourceSheet: text('source_sheet').notNull(),
    sourceChecksum: text('source_checksum').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('category_attribute_dictionary_name_version_key').on(
      table.attributeName,
      table.controlsVersion,
    ),
    uniqueIndex('category_attribute_dictionary_key_version_key').on(
      table.canonicalAttributeKey,
      table.controlsVersion,
    ),
  ],
);

/**
 * One row per (category, attribute) - 53,625 rows from
 * `Category_Attribute_Controls`. `sourceBasis` is free text (132 distinct
 * values in the source data) rather than an enum, matching the workbook's
 * own shape - it is provenance for a reviewer, never a value this code
 * branches on.
 */
export const categoryAttributeControls = pgTable(
  'category_attribute_controls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => sals3Categories.id, { onDelete: 'restrict' }),
    controlsVersion: text('controls_version').notNull(),
    attributeName: text('attribute_name').notNull(),
    requirementLevel:
      attributeRequirementLevelEnum('requirement_level').notNull(),
    inputControlType:
      attributeInputControlTypeEnum('input_control_type').notNull(),
    allowedValues: text('allowed_values').array().notNull().default([]),
    allowCustomValue: boolean('allow_custom_value').notNull(),
    allowMultipleValues: boolean('allow_multiple_values').notNull(),
    sellerHelpText: text('seller_help_text'),
    seoVisibility: attributeSeoVisibilityEnum('seo_visibility').notNull(),
    aeoGeoVisibility:
      attributeAeoGeoVisibilityEnum('aeo_geo_visibility').notNull(),
    complianceReviewFlag: attributeComplianceReviewFlagEnum(
      'compliance_review_flag',
    ).notNull(),
    sourceBasis: text('source_basis'),
    sourceWorkbook: text('source_workbook').notNull(),
    sourceSheet: text('source_sheet').notNull(),
    sourceChecksum: text('source_checksum').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      'category_attribute_controls_category_attribute_version_key',
    ).on(table.categoryId, table.attributeName, table.controlsVersion),
    index('category_attribute_controls_category_idx').on(table.categoryId),
    index('category_attribute_controls_version_idx').on(table.controlsVersion),
    /**
     * "Every attribute name a control row uses exists in the dictionary" is
     * already true of all 53,625 source rows (verified by the extraction
     * script). This composite FK - backed by the dictionary's own
     * `(attributeName, controlsVersion)` unique index - makes that a
     * database invariant instead of an extraction-time assertion alone.
     */
    foreignKey({
      columns: [table.attributeName, table.controlsVersion],
      foreignColumns: [
        categoryAttributeDictionary.attributeName,
        categoryAttributeDictionary.controlsVersion,
      ],
    }),
    check(
      'category_attribute_controls_name_not_blank',
      sql`length(btrim(${table.attributeName})) > 0`,
    ),
    /**
     * Proven true of all 53,625 source rows: dropdown types carry at least
     * one allowed value, and no other control type carries any.
     */
    check(
      'category_attribute_controls_allowed_values_match_type',
      sql`(${table.inputControlType} in ('SINGLE_SELECT_DROPDOWN','MULTI_SELECT_DROPDOWN') and array_length(${table.allowedValues}, 1) > 0)
          or (${table.inputControlType} not in ('SINGLE_SELECT_DROPDOWN','MULTI_SELECT_DROPDOWN') and coalesce(array_length(${table.allowedValues}, 1), 0) = 0)`,
    ),
  ],
);

export type CategoryAttributeDictionaryRow =
  typeof categoryAttributeDictionary.$inferSelect;
export type NewCategoryAttributeDictionaryRow =
  typeof categoryAttributeDictionary.$inferInsert;
export type CategoryAttributeControlRow =
  typeof categoryAttributeControls.$inferSelect;
export type NewCategoryAttributeControlRow =
  typeof categoryAttributeControls.$inferInsert;

export type AttributeInputControlType =
  (typeof attributeInputControlTypeEnum.enumValues)[number];
export type AttributeRequirementLevel =
  (typeof attributeRequirementLevelEnum.enumValues)[number];
export type AttributeSeoVisibility =
  (typeof attributeSeoVisibilityEnum.enumValues)[number];
export type AttributeAeoGeoVisibility =
  (typeof attributeAeoGeoVisibilityEnum.enumValues)[number];
export type AttributeComplianceReviewFlag =
  (typeof attributeComplianceReviewFlagEnum.enumValues)[number];
export type AttributeDataType =
  (typeof attributeDataTypeEnum.enumValues)[number];
