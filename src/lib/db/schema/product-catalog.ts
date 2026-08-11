import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { sals3Categories } from './pricing-policy';
import { sellerAccounts } from './seller-accounts';
import { supplierCandidates } from './catalog';
import { supplierConnections } from './supplier-connections';
import { supplierProviders } from './supplier-providers';

/**
 * The canonical Sals3 product lifecycle: Product -> Revision -> Options /
 * Variants -> seller Offer, plus the exact provider references and supplier
 * binding that connect a Sals3 variant back to one CJ variant on one seller's
 * own connection.
 *
 * This is the first real implementation of
 * `cj-candidate-to-sals3-product-draft-implementation-spec.md` §5.1/§5.2 and
 * ADR-006's "Product and offer identity correction". Everything before it -
 * `supplier_candidates`, `candidate_evaluations`, `supplier_snapshots` - is
 * discovery and screening state. Nothing in those tables is a Sals3 product,
 * and nothing here becomes published, sellable, stock-confirmed, or public
 * merely by existing.
 *
 * ## Three different ownership scopes, deliberately not merged
 *
 * ADR-006 settles what would otherwise be a contradiction between "one
 * provider product reference per (provider, external id)" and "a seller
 * cannot touch another seller's records": *"Two Dropshipper accounts may
 * source the same global provider product while using separate credentials,
 * wallets, orders, and account-specific availability."* So:
 *
 * - **Canonical / platform-scoped** - `products` identity, `product_options`,
 *   `product_option_values`, `product_variants`, `provider_product_references`,
 *   `provider_variant_references`. Keyed off the provider product, shared by
 *   every seller that sources it. Re-importing the same CJ `pid` reuses these
 *   (spec §4.2) instead of forking a second canonical identity.
 * - **Steward-scoped** - `product_revisions` and the editorial columns on
 *   `products` (title, slug, description, category, brand). Exactly one seller
 *   account owns the editorial record: `products.steward_seller_account_id`.
 *   A different seller can never read or mutate that draft.
 * - **Seller-scoped** - `product_offers` and `offer_supplier_bindings`. Each
 *   seller's own commercial offer for a canonical variant, in one market, with
 *   one fulfillment mode, fulfilled through that seller's own connection.
 *
 * ## Honesty invariants enforced by the database, not by application code
 *
 * Constraints below - not tests, not repository functions - are what make
 * these true under concurrency:
 *
 * - a variant cannot be `ACTIVE` without a resolved option combination;
 * - two `ACTIVE` variants of one product cannot share an option combination;
 * - one variant cannot carry the same option twice;
 * - a `PUBLISHED` product must point at a real published revision and a slug;
 * - a `PUBLISHED` offer must have a price;
 * - a compare-at price cannot exist without price-history evidence
 *   (the fabricated-comparison-price defect this repository already fixed
 *   once in the storefront feed);
 * - an approved/superseded revision must carry its frozen content snapshot;
 * - a supplier-dropship offer has at most one `ACTIVE` binding.
 *
 * ## Google Merchant Center (ADR-016 §2)
 *
 * ADR-016 requires the *first* Product/Offer/Media migration to carry the
 * Merchant API columns so a real catalog is never retrofitted later. They are
 * nullable and **never auto-populated**: ADR-013 §7 still forbids inventing a
 * GTIN, MPN, or brand. `gtins`/`mpn`/`identifier_exists` sit on the variant
 * because one Sals3 variant maps to one Merchant API offer; `brand_name`,
 * `google_product_category`, `condition`, `age_group`, and `gender` sit on the
 * product because they are shared across its variants. Prices are integer
 * minor units in a `bigint`, which converts losslessly to Merchant API
 * `amountMicros` (`minor * 10_000` for a two-decimal currency).
 *
 * No `Promotion` table exists here on purpose. ADR-016 §2 makes it conditional
 * - *"if and when a genuine discount feature is built"* - and Sals3 has no
 * discount concept at all today (`hot.md`: the "Deals" band is a ranking, not a
 * savings claim). An empty promotion table would be the fabricated-promotion
 * this ADR explicitly warns against.
 */

// --- Product -----------------------------------------------------------------

/** Spec §6.3. `UNPUBLISHED` is the only state anything in this task can reach. */
export const productPublicationStateEnum = pgEnum('product_publication_state', [
  'UNPUBLISHED',
  'PUBLISHED',
  'PAUSED',
  'ARCHIVED',
]);

/** Spec §5.1. `DECLARED` requires resolved brand/IP evidence (spec §7). */
export const productBrandModeEnum = pgEnum('product_brand_mode', [
  'UNBRANDED',
  'DECLARED',
]);

/** Merchant API `condition` (ADR-016 §2). Nullable; defaults to nothing. */
export const productConditionEnum = pgEnum('product_condition', [
  'NEW',
  'REFURBISHED',
  'USED',
]);

/** Merchant API `ageGroup`. Category-gated, never guessed from a supplier title. */
export const productAgeGroupEnum = pgEnum('product_age_group', [
  'NEWBORN',
  'INFANT',
  'TODDLER',
  'KIDS',
  'ADULT',
]);

/** Merchant API `gender`. Category-gated, never guessed. */
export const productGenderEnum = pgEnum('product_gender', [
  'MALE',
  'FEMALE',
  'UNISEX',
]);

/**
 * ADR-002's four states, mirroring `modules/pricing/types.ts`'s
 * `CategoryMappingConfidence` so the pricing resolver's refusal to price an
 * `AMBIGUOUS`/`UNMAPPED` product reads the same value the product stores.
 * A CJ-sourced draft starts `UNMAPPED`: no CJ-to-Sals3 taxonomy crosswalk
 * exists (spec §26 "Explicitly NOT implemented").
 */
export const categoryMappingConfidenceEnum = pgEnum(
  'category_mapping_confidence',
  ['EXACT', 'ACCEPTABLE', 'AMBIGUOUS', 'UNMAPPED'],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The one seller account that owns this product's **editorial** record.
     * Canonical identity is shared (see the module doc), but exactly one
     * tenant may author its title, description, category, brand, options,
     * and revisions. Every editorial read and write folds this into its
     * `WHERE` clause.
     */
    stewardSellerAccountId: uuid('steward_seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),

    /**
     * Spec §7: seeded from the CJ name as a *draft suggestion* and owned by
     * Sals3 from then on. A later supplier rename never overwrites it.
     */
    title: text('title').notNull(),

    /**
     * Null until publication. Spec §4.3 makes the slug unique among active
     * public products only - a thousand drafts sharing a working title must
     * not collide, and a historical slug stays reserved for redirects.
     */
    slug: text('slug'),

    categoryId: uuid('category_id').references(() => sals3Categories.id, {
      onDelete: 'restrict',
    }),
    categoryMappingConfidence: categoryMappingConfidenceEnum(
      'category_mapping_confidence',
    )
      .notNull()
      .default('UNMAPPED'),

    brandMode: productBrandModeEnum('brand_mode')
      .notNull()
      .default('UNBRANDED'),
    /** Merchant API `brand` (ADR-016). Only ever set with real brand evidence. */
    brandName: text('brand_name'),

    /** ADR-016 §2. Populated later by an ADR-002 crosswalk that does not exist yet. */
    googleProductCategory: text('google_product_category'),
    condition: productConditionEnum('condition'),
    ageGroup: productAgeGroupEnum('age_group'),
    gender: productGenderEnum('gender'),

    publicationState: productPublicationStateEnum('publication_state')
      .notNull()
      .default('UNPUBLISHED'),

    /**
     * Pointers into `product_revisions`. Circular by nature (a revision
     * belongs to a product); Postgres allows it because Drizzle Kit emits
     * both foreign keys as `ALTER TABLE ... ADD CONSTRAINT` after the tables
     * exist. `AnyPgColumn` is the documented way to express the cycle without
     * a TypeScript circular-inference error.
     */
    /* eslint-disable no-use-before-define -- genuine cycle: a product points
       at its current/published revision while a revision belongs to a
       product. The thunk defers evaluation, so nothing is actually read
       before it is defined. */
    currentRevisionId: uuid('current_revision_id').references(
      (): AnyPgColumn => productRevisions.id,
      { onDelete: 'set null' },
    ),
    publishedRevisionId: uuid('published_revision_id').references(
      (): AnyPgColumn => productRevisions.id,
      { onDelete: 'set null' },
    ),
    /* eslint-enable no-use-before-define */

    /** Optimistic-concurrency token for product-level edits. */
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: text('published_by'),
  },
  (table) => [
    /**
     * Spec §4.3: unique among *active public* products. A partial index is
     * the whole point - making it unconditional would reject two drafts that
     * happen to share a generated slug, and dropping it would let two live
     * products claim one public URL.
     */
    uniqueIndex('products_public_slug_key')
      .on(table.slug)
      .where(sql`${table.publicationState} = 'PUBLISHED'`),
    index('products_steward_idx').on(table.stewardSellerAccountId),
    index('products_publication_state_idx').on(table.publicationState),
    /** A published product without a public revision would be an empty PDP. */
    check(
      'products_published_requires_revision',
      sql`${table.publicationState} <> 'PUBLISHED' OR ${table.publishedRevisionId} IS NOT NULL`,
    ),
    check(
      'products_published_requires_slug',
      sql`${table.publicationState} <> 'PUBLISHED' OR ${table.slug} IS NOT NULL`,
    ),
    /** Spec §7: a declared brand needs a name to declare. */
    check(
      'products_declared_brand_requires_name',
      sql`${table.brandMode} <> 'DECLARED' OR ${table.brandName} IS NOT NULL`,
    ),
    /**
     * A mapped confidence needs a category, and a category needs a
     * confidence better than `UNMAPPED`. Keeps the pricing resolver's
     * `CATEGORY_MAPPING_REQUIRES_REVIEW` branch meaningful.
     */
    check(
      'products_category_mapping_consistent',
      sql`(${table.categoryId} IS NULL) = (${table.categoryMappingConfidence} = 'UNMAPPED')`,
    ),
  ],
);

// --- Product revision --------------------------------------------------------

/** Spec §6.2. */
export const productRevisionWorkflowStateEnum = pgEnum(
  'product_revision_workflow_state',
  ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SUPERSEDED'],
);

/** Spec §6.2: automatic approval is a *recorded server decision*, never an absence. */
export const productRevisionApprovalModeEnum = pgEnum(
  'product_revision_approval_mode',
  ['AUTO', 'MANUAL_EXCEPTION'],
);

/** ADR-011 §2's revision-level picture preference. */
export const productMediaPreferenceEnum = pgEnum('product_media_preference', [
  'SELLER_FIRST',
  'SUPPLIER_ONLY',
]);

/**
 * One editorial version of a product's customer-facing content.
 *
 * `content_document` is the mutable working copy and is writable **only**
 * while `workflow_state = 'DRAFT'` - every repository update names that state
 * in its `WHERE` clause alongside the expected `version`, so a stale editor
 * and a submitted revision both match zero rows instead of overwriting.
 * `content_snapshot` is the frozen copy taken at approval; the check
 * constraint below makes "approved but never frozen" unrepresentable, which is
 * what stops a later edit from silently rewriting what a reviewer approved or
 * what an accepted order referenced (ADR-007 invariant 3).
 *
 * The document itself is a structured, allow-listed block format validated by
 * `modules/catalog/products/description-document.ts`. Raw supplier HTML never
 * enters it: CJ's `description` is fetched and stored as evidence but has no
 * sanitiser (spec §26), so a CJ-sourced draft starts with an empty document
 * rather than an unsafe one.
 */
export const productRevisions = pgTable(
  'product_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references((): AnyPgColumn => products.id, { onDelete: 'restrict' }),

    revisionNumber: integer('revision_number').notNull(),

    workflowState: productRevisionWorkflowStateEnum('workflow_state')
      .notNull()
      .default('DRAFT'),

    /** Structured, allow-listed blocks. Never raw supplier HTML. */
    contentDocument: jsonb('content_document').notNull(),
    /** SHA-256 of the canonical content document, for audit and reproducibility. */
    contentChecksum: text('content_checksum').notNull(),
    /** Frozen copy taken when the revision leaves DRAFT. Immutable afterwards. */
    contentSnapshot: jsonb('content_snapshot'),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),

    mediaPreference: productMediaPreferenceEnum('media_preference')
      .notNull()
      .default('SELLER_FIRST'),

    /** Which product version this revision was forked from (spec §16). */
    expectedProductVersion: integer('expected_product_version').notNull(),

    approvalMode: productRevisionApprovalModeEnum('approval_mode'),
    approvalPolicyVersion: text('approval_policy_version'),

    /** Optimistic-concurrency token. Every draft save must state the value it read. */
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedBy: text('submitted_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
  },
  (table) => [
    uniqueIndex('product_revisions_product_number_key').on(
      table.productId,
      table.revisionNumber,
    ),
    /**
     * At most one open draft per product. This is what makes "editing a
     * published product forks a new draft" deterministic: a second fork
     * attempt collides instead of creating a rival draft nobody can
     * reconcile.
     */
    uniqueIndex('product_revisions_open_draft_key')
      .on(table.productId)
      .where(sql`${table.workflowState} = 'DRAFT'`),
    index('product_revisions_product_state_idx').on(
      table.productId,
      table.workflowState,
    ),
    /**
     * Spec §16: "Product revisions are immutable snapshots after submission."
     * Without this, an APPROVED revision with a null snapshot would leave
     * nothing to compare a later edit against - the immutability guarantee
     * would exist only in prose.
     */
    check(
      'product_revisions_frozen_when_settled',
      sql`${table.workflowState} NOT IN ('APPROVED', 'SUPERSEDED') OR (${table.contentSnapshot} IS NOT NULL AND ${table.frozenAt} IS NOT NULL)`,
    ),
    /** Spec §6.2: an approved revision records *how* it was approved. */
    check(
      'product_revisions_approved_records_mode',
      sql`${table.workflowState} <> 'APPROVED' OR (${table.approvalMode} IS NOT NULL AND ${table.approvalPolicyVersion} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`,
    ),
    check(
      'product_revisions_number_positive',
      sql`${table.revisionNumber} >= 1`,
    ),
  ],
);

// --- Options and option values -----------------------------------------------

/**
 * A Sals3-owned option axis (Colour, Size). Spec §7 keeps the *display* name
 * Sals3-owned while the external link lives on the provider variant
 * reference, so a CJ label change never rewrites the seller's wording.
 *
 * `normalized_name` is the case/whitespace-folded key uniqueness is enforced
 * on; the raw `name` is what a customer sees.
 */
export const productOptions = pgTable(
  'product_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('product_options_product_normalized_name_key').on(
      table.productId,
      table.normalizedName,
    ),
    uniqueIndex('product_options_product_position_key').on(
      table.productId,
      table.position,
    ),
    check('product_options_position_non_negative', sql`${table.position} >= 0`),
  ],
);

export const productOptionValues = pgTable(
  'product_option_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    optionId: uuid('option_id')
      .notNull()
      .references(() => productOptions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('product_option_values_option_normalized_key').on(
      table.optionId,
      table.normalizedValue,
    ),
    uniqueIndex('product_option_values_option_position_key').on(
      table.optionId,
      table.position,
    ),
    check(
      'product_option_values_position_non_negative',
      sql`${table.position} >= 0`,
    ),
  ],
);

// --- Variants ----------------------------------------------------------------

/** Spec §5.1. A candidate-sourced variant starts `DRAFT` - never `ACTIVE`. */
export const productVariantStatusEnum = pgEnum('product_variant_status', [
  'DRAFT',
  'ACTIVE',
  'UNAVAILABLE',
  'RETIRED',
]);

/**
 * The stable Sals3 sellable identity (spec §4.1). Survives every CJ label,
 * ordering, and SKU change - ADR-013 §7's "preserve Sals3 variant IDs".
 *
 * `option_combination_key` is a denormalized, sorted, normalized rendering of
 * this variant's option-value set. A pure relational constraint cannot say
 * "no two active variants share the same *set* of values", so the key plus a
 * partial unique index is what actually enforces spec §4.3. The paired check
 * constraint closes the hole a partial index leaves open on its own: SQL
 * unique indexes ignore NULLs, so without it an `ACTIVE` variant with an
 * unresolved combination would slip past the very rule the index exists for.
 *
 * That check is also the structural answer to "variant status cannot be
 * fabricated as ACTIVE merely because it came from a supplier candidate": a
 * CJ variant arrives as one unstructured label (`"Black-1XL"`), which is not a
 * mapped Sals3 option combination, so the row physically cannot be stored as
 * `ACTIVE` until someone maps it.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),

    /** Spec §4.3: globally unique, and immutable after first publication. */
    sals3Sku: text('sals3_sku').notNull(),

    status: productVariantStatusEnum('status').notNull().default('DRAFT'),

    /** Null until every option axis is mapped. See the table doc comment. */
    optionCombinationKey: text('option_combination_key'),

    /** ADR-016 §2 - Merchant API identifiers. Never invented (ADR-013 §7). */
    gtins: text('gtins').array(),
    mpn: text('mpn'),
    identifierExists: boolean('identifier_exists').notNull().default(true),

    /** Supplier facts with an audited-override path (spec §7). Minor units, non-negative. */
    weightGrams: integer('weight_grams'),
    lengthMillimeters: integer('length_millimeters'),
    widthMillimeters: integer('width_millimeters'),
    heightMillimeters: integer('height_millimeters'),

    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by').notNull(),
    firstPublishedAt: timestamp('first_published_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('product_variants_sals3_sku_key').on(table.sals3Sku),
    uniqueIndex('product_variants_active_combination_key')
      .on(table.productId, table.optionCombinationKey)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('product_variants_product_status_idx').on(
      table.productId,
      table.status,
    ),
    check(
      'product_variants_active_requires_combination',
      sql`${table.status} <> 'ACTIVE' OR ${table.optionCombinationKey} IS NOT NULL`,
    ),
    /** ADR-016: Merchant API accepts at most 10 GTINs per offer. */
    check(
      'product_variants_gtin_cardinality',
      sql`${table.gtins} IS NULL OR cardinality(${table.gtins}) <= 10`,
    ),
    check(
      'product_variants_dimensions_non_negative',
      sql`(${table.weightGrams} IS NULL OR ${table.weightGrams} >= 0)
        AND (${table.lengthMillimeters} IS NULL OR ${table.lengthMillimeters} >= 0)
        AND (${table.widthMillimeters} IS NULL OR ${table.widthMillimeters} >= 0)
        AND (${table.heightMillimeters} IS NULL OR ${table.heightMillimeters} >= 0)`,
    ),
  ],
);

/**
 * Which option value each variant carries on each axis. The unique key on
 * `(variant_id, option_id)` is spec §4.3's "one variant cannot contain the
 * same option twice" - enforced here rather than left to an application
 * check two concurrent writers would both pass.
 */
export const productVariantOptionValues = pgTable(
  'product_variant_option_values',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => productOptions.id, { onDelete: 'restrict' }),
    optionValueId: uuid('option_value_id')
      .notNull()
      .references(() => productOptionValues.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('product_variant_option_values_variant_option_key').on(
      table.variantId,
      table.optionId,
    ),
    index('product_variant_option_values_value_idx').on(table.optionValueId),
  ],
);

// --- Provider references -----------------------------------------------------

/**
 * How current Sals3 believes the provider's own record to be. `UNKNOWN` is
 * the honest default for a reference built from a stored snapshot: nothing in
 * this task re-contacts CJ, so claiming `ACTIVE` would assert a fact no code
 * checked.
 */
export const providerSourceStatusEnum = pgEnum('provider_source_status', [
  'UNKNOWN',
  'ACTIVE',
  'INACTIVE',
  'REMOVED',
]);

/** Spec §6.4. `STALE` on creation: the snapshot is history, not a live read. */
export const providerSyncStateEnum = pgEnum('provider_sync_state', [
  'HEALTHY',
  'STALE',
  'CONFLICT',
  'ERROR',
  'DISABLED',
]);

/**
 * The canonical link from one Sals3 product to one provider product. Unique on
 * `(supplier_provider_id, external_product_id)` per spec §4.2 and ADR-006, so
 * re-importing the same CJ `pid` resolves to the existing Sals3 product
 * instead of forking a duplicate catalog identity - and two different `pid`s
 * can never auto-merge, because nothing but an exact external id matches here.
 *
 * Deliberately carries no credential and no connection: ADR-006 separates
 * provider *product identity* (global) from *fulfillment authority*
 * (per-seller, on `offer_supplier_bindings`).
 */
export const providerProductReferences = pgTable(
  'provider_product_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    supplierProviderId: uuid('supplier_provider_id')
      .notNull()
      .references(() => supplierProviders.id, { onDelete: 'restrict' }),
    externalProductId: text('external_product_id').notNull(),

    /**
     * The candidate this reference was first built from. Provenance only -
     * uniqueness and tenancy never resolve through it, because a candidate is
     * connection-scoped while this row is global.
     */
    sourceCandidateId: uuid('source_candidate_id').references(
      () => supplierCandidates.id,
      { onDelete: 'set null' },
    ),

    sourceStatus: providerSourceStatusEnum('source_status')
      .notNull()
      .default('UNKNOWN'),
    syncState: providerSyncStateEnum('sync_state').notNull().default('STALE'),

    /** SHA-256 of the `supplier_snapshots` evidence this reference was built from. */
    snapshotChecksum: text('snapshot_checksum'),
    /** When that evidence was captured - never "now", which would overstate freshness. */
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', {
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_product_references_provider_external_key').on(
      table.supplierProviderId,
      table.externalProductId,
    ),
    /** One canonical provider record per product; a second would be ambiguous routing. */
    uniqueIndex('provider_product_references_product_provider_key').on(
      table.productId,
      table.supplierProviderId,
    ),
  ],
);

/**
 * The exact provider variant behind one Sals3 variant. Unique on
 * `(provider_product_reference_id, external_variant_id)` per spec §4.3.
 *
 * `source_option_label` preserves CJ's own unstructured variant key (for
 * example `"Black-1XL"`) verbatim. It is *not* parsed into Sals3 options:
 * splitting that string would be a guess about which token is a colour and
 * which is a size, and a wrong guess becomes a customer-facing product
 * attribute. Mapping it stays an explicit, authorized operator action.
 */
export const providerVariantReferences = pgTable(
  'provider_variant_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerProductReferenceId: uuid('provider_product_reference_id')
      .notNull()
      .references(() => providerProductReferences.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),

    externalVariantId: text('external_variant_id').notNull(),
    externalSku: text('external_sku'),
    /** CJ's raw `variantKey`. Read-only provenance, never a parsed option model. */
    sourceOptionLabel: text('source_option_label'),

    sourceStatus: providerSourceStatusEnum('source_status')
      .notNull()
      .default('UNKNOWN'),

    /** Supplier cost as last *observed in stored evidence*, in integer minor units. */
    lastObservedCostMinor: bigint('last_observed_cost_minor', {
      mode: 'bigint',
    }),
    lastObservedCostCurrency: text('last_observed_cost_currency'),
    lastObservedInventory: integer('last_observed_inventory'),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_variant_references_reference_external_key').on(
      table.providerProductReferenceId,
      table.externalVariantId,
    ),
    /** One provider variant per Sals3 variant; two would make routing ambiguous. */
    uniqueIndex('provider_variant_references_variant_key').on(table.variantId),
    check(
      'provider_variant_references_cost_paired',
      sql`(${table.lastObservedCostMinor} IS NULL) = (${table.lastObservedCostCurrency} IS NULL)`,
    ),
    check(
      'provider_variant_references_cost_non_negative',
      sql`${table.lastObservedCostMinor} IS NULL OR ${table.lastObservedCostMinor} >= 0`,
    ),
    check(
      'provider_variant_references_inventory_non_negative',
      sql`${table.lastObservedInventory} IS NULL OR ${table.lastObservedInventory} >= 0`,
    ),
  ],
);

// --- Offers ------------------------------------------------------------------

/** ADR-001 §3. An implementation enum, never customer-facing copy. */
export const offerFulfillmentModeEnum = pgEnum('offer_fulfillment_mode', [
  'SALS3_STOCK',
  'SUPPLIER_DROPSHIP',
  'THIRD_PARTY_WAREHOUSE',
  'DIGITAL',
]);

export const offerPublishStateEnum = pgEnum('offer_publish_state', [
  'UNPUBLISHED',
  'PUBLISHED',
  'PAUSED',
  'ARCHIVED',
]);

/**
 * `UNKNOWN` is the honest starting value and the only one this task can
 * produce. ADR-013 §1a: a candidate's stock state is `STOCK_NOT_CHECKED`
 * until someone actually looks, and a customer-facing availability claim
 * never comes from a stored `totalInventory` alone.
 */
export const offerAvailabilityStateEnum = pgEnum('offer_availability_state', [
  'UNKNOWN',
  'AVAILABLE',
  'UNAVAILABLE',
]);

/**
 * Whether a server-owned ADR-015 price was actually resolved for this offer.
 * `UNRESOLVED` carries the resolver's own reason string rather than a
 * fabricated placeholder price - see `modules/pricing/types.ts`.
 */
export const offerPricingStateEnum = pgEnum('offer_pricing_state', [
  'UNRESOLVED',
  'RESOLVED',
]);

/**
 * One seller's commercial offer for one canonical variant, in one market,
 * under one fulfillment mode (spec §4.3, §5.1).
 *
 * Money is integer minor units in a `bigint` and always paired with an ISO
 * currency - no float touches this path, and `minor * 10_000` is the lossless
 * Merchant API `amountMicros` conversion ADR-016 §2 requires.
 *
 * `market_code` is free text on purpose. The allowed set is resolved
 * server-side from the seller's own `seller_market_profiles` row intersected
 * with `modules/market-config/capabilities.ts`; encoding today's pilot
 * destinations as a Postgres enum would need a migration every time the
 * policy moves and would hard-code a market this codebase has spent real
 * effort removing.
 */
export const productOffers = pgTable(
  'product_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),

    marketCode: text('market_code').notNull(),
    fulfillmentMode: offerFulfillmentModeEnum('fulfillment_mode').notNull(),

    priceAmountMinor: bigint('price_amount_minor', { mode: 'bigint' }),
    priceCurrency: text('price_currency'),

    /**
     * Spec §7/§13: never derived from an uplift on the current price. The
     * check below makes an evidence-free comparison price impossible to
     * store, which is the durable version of the fix this repository already
     * shipped once for the storefront feed's fabricated `oldPriceMinor`.
     */
    compareAtAmountMinor: bigint('compare_at_amount_minor', { mode: 'bigint' }),
    compareAtCurrency: text('compare_at_currency'),
    comparisonEvidenceId: text('comparison_evidence_id'),

    availabilityState: offerAvailabilityStateEnum('availability_state')
      .notNull()
      .default('UNKNOWN'),
    publishState: offerPublishStateEnum('publish_state')
      .notNull()
      .default('UNPUBLISHED'),

    pricingState: offerPricingStateEnum('pricing_state')
      .notNull()
      .default('UNRESOLVED'),
    /** The resolver's own `PricingUnavailableReason` when `UNRESOLVED`. */
    pricingUnavailableReason: text('pricing_unavailable_reason'),
    /** `PRICING_RESOLVER_VERSION` - which logic produced a resolved price. */
    pricingResolverVersion: text('pricing_resolver_version'),
    /** ADR-015 §7's explainable decision snapshot: resolved layers and inputs. */
    pricingDecision: jsonb('pricing_decision'),

    /** Which `seller_market_profiles` row authorized this offer's market. */
    marketProfileId: uuid('market_profile_id'),
    marketCapabilityVersion: text('market_capability_version').notNull(),

    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    /** Spec §4.3's exact tuple. */
    uniqueIndex('product_offers_seller_variant_market_mode_key').on(
      table.sellerAccountId,
      table.variantId,
      table.marketCode,
      table.fulfillmentMode,
    ),
    index('product_offers_seller_idx').on(table.sellerAccountId),
    index('product_offers_variant_idx').on(table.variantId),
    check(
      'product_offers_price_paired',
      sql`(${table.priceAmountMinor} IS NULL) = (${table.priceCurrency} IS NULL)`,
    ),
    check(
      'product_offers_price_non_negative',
      sql`${table.priceAmountMinor} IS NULL OR ${table.priceAmountMinor} >= 0`,
    ),
    /** An unpriced live offer would be a checkout with no amount. */
    check(
      'product_offers_published_requires_price',
      sql`${table.publishState} <> 'PUBLISHED' OR ${table.priceAmountMinor} IS NOT NULL`,
    ),
    /** No compare-at price without real price-history evidence behind it. */
    check(
      'product_offers_compare_at_requires_evidence',
      sql`${table.compareAtAmountMinor} IS NULL OR (${table.comparisonEvidenceId} IS NOT NULL AND ${table.compareAtCurrency} IS NOT NULL)`,
    ),
    /** A resolved price must say which resolver produced it; an unresolved one must say why. */
    check(
      'product_offers_pricing_state_explained',
      sql`(${table.pricingState} = 'RESOLVED' AND ${table.pricingResolverVersion} IS NOT NULL AND ${table.priceAmountMinor} IS NOT NULL)
        OR (${table.pricingState} = 'UNRESOLVED' AND ${table.pricingUnavailableReason} IS NOT NULL)`,
    ),
    check(
      'product_offers_market_code_shape',
      sql`${table.marketCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

// --- Offer supplier binding --------------------------------------------------

/**
 * `UNVERIFIED` is where a binding built from stored evidence starts. Nothing
 * in this task contacts CJ, so no binding may claim it was verified sellable.
 */
export const offerSupplierBindingStateEnum = pgEnum(
  'offer_supplier_binding_state',
  ['UNVERIFIED', 'ACTIVE', 'SUSPENDED', 'RETIRED'],
);

/**
 * The exact fulfillment authority for one offer: which seller-owned
 * connection, and which provider variant (ADR-006). Order routing resolves
 * this row and never silently chooses another provider.
 *
 * The partial unique index is ADR-006's *"a supplier-dropship Offer has
 * exactly one active `OfferSupplierBinding`"*. Retired bindings stay as
 * history alongside it rather than being deleted, so a past routing decision
 * remains explainable.
 */
export const offerSupplierBindings = pgTable(
  'offer_supplier_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => productOffers.id, { onDelete: 'restrict' }),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    providerVariantReferenceId: uuid('provider_variant_reference_id')
      .notNull()
      .references(() => providerVariantReferences.id, { onDelete: 'restrict' }),

    state: offerSupplierBindingStateEnum('state')
      .notNull()
      .default('UNVERIFIED'),
    /** Stable code explaining a non-active state, e.g. `SUPPLIER_CONNECTION_UNHEALTHY`. */
    stateReason: text('state_reason'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('offer_supplier_bindings_active_key')
      .on(table.offerId)
      .where(sql`${table.state} = 'ACTIVE'`),
    /**
     * Idempotency anchor: replaying the draft flow resolves the same
     * (offer, connection, provider variant) triple to the existing row
     * instead of stacking `UNVERIFIED` duplicates the partial index above
     * would happily allow.
     */
    uniqueIndex('offer_supplier_bindings_offer_connection_variant_key').on(
      table.offerId,
      table.supplierConnectionId,
      table.providerVariantReferenceId,
    ),
    index('offer_supplier_bindings_connection_idx').on(
      table.supplierConnectionId,
    ),
  ],
);

// --- Media provenance --------------------------------------------------------

/** ADR-011 §1: source evidence and publishable asset are different things. */
export const productMediaSourceTypeEnum = pgEnum('product_media_source_type', [
  'SUPPLIER_ORIGINAL',
  'SELLER_UPLOAD',
]);

/** ADR-011 §6: a rights basis is required before publication, never assumed. */
export const productMediaRightsBasisEnum = pgEnum(
  'product_media_rights_basis',
  ['UNKNOWN', 'SUPPLIER_TERMS', 'SELLER_DECLARED'],
);

export const productMediaReviewStateEnum = pgEnum(
  'product_media_review_state',
  ['NOT_REVIEWED', 'APPROVED', 'REJECTED'],
);

/**
 * Durable provenance for one observed media source (ADR-011 §1, ADR-016 §2's
 * "first Product/Offer/Media migration").
 *
 * This is the *observation*, not a publishable asset: no file is fetched,
 * stored, transformed, or rendered anywhere in this task, and
 * `merchant_center_eligible` stays null because no watermark/overlay/
 * resolution check exists yet (ADR-016 §4 requires that check to be part of
 * the media pipeline when it is built, not a bolt-on).
 *
 * The candidate-to-draft flow writes **no rows here**. The persisted CJ
 * evidence records only a usable-image *count* (`lib/cj/evidence.ts`'s
 * `countUsableImages`), never the URLs themselves, so there is nothing
 * truthful to record. The table exists now because ADR-016 makes it a
 * first-migration requirement and because retrofitting checksum/rights/
 * provenance onto live media rows later is exactly the expensive migration
 * that ADR is written to prevent.
 */
export const productMediaSources = pgTable(
  'product_media_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Set when the media depicts one specific variant (ADR-013 §8). */
    variantId: uuid('variant_id').references(() => productVariants.id, {
      onDelete: 'set null',
    }),

    sourceType: productMediaSourceTypeEnum('source_type').notNull(),
    /** Allow-listed supplier host only; never an arbitrary browser-supplied URL. */
    sourceUrl: text('source_url'),
    /** Stable supplier-side identity when one exists, so a URL change is detectable. */
    sourceExternalId: text('source_external_id'),
    /** SHA-256 of the observed bytes when they have actually been read. */
    checksum: text('checksum'),
    contentType: text('content_type'),
    byteSize: integer('byte_size'),
    widthPixels: integer('width_pixels'),
    heightPixels: integer('height_pixels'),

    rightsBasis: productMediaRightsBasisEnum('rights_basis')
      .notNull()
      .default('UNKNOWN'),
    reviewState: productMediaReviewStateEnum('review_state')
      .notNull()
      .default('NOT_REVIEWED'),
    /** ADR-016 §4. Null = never checked, which is not the same as eligible. */
    merchantCenterEligible: boolean('merchant_center_eligible'),

    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
  },
  (table) => [
    /** Same file observed twice is one record; a checksum-less row is not deduplicable. */
    uniqueIndex('product_media_sources_product_checksum_key')
      .on(table.productId, table.checksum)
      .where(sql`${table.checksum} is not null`),
    index('product_media_sources_product_idx').on(table.productId),
    check(
      'product_media_sources_dimensions_non_negative',
      sql`(${table.byteSize} IS NULL OR ${table.byteSize} >= 0)
        AND (${table.widthPixels} IS NULL OR ${table.widthPixels} >= 0)
        AND (${table.heightPixels} IS NULL OR ${table.heightPixels} >= 0)`,
    ),
    /** An approved asset must say what right approved it. */
    check(
      'product_media_sources_approved_requires_rights',
      sql`${table.reviewState} <> 'APPROVED' OR ${table.rightsBasis} <> 'UNKNOWN'`,
    ),
  ],
);

// --- Row types ---------------------------------------------------------------

export type ProductPublicationState =
  (typeof productPublicationStateEnum.enumValues)[number];
export type ProductRevisionWorkflowState =
  (typeof productRevisionWorkflowStateEnum.enumValues)[number];
export type ProductVariantStatus =
  (typeof productVariantStatusEnum.enumValues)[number];
export type OfferFulfillmentMode =
  (typeof offerFulfillmentModeEnum.enumValues)[number];
export type OfferPublishState =
  (typeof offerPublishStateEnum.enumValues)[number];
export type OfferSupplierBindingState =
  (typeof offerSupplierBindingStateEnum.enumValues)[number];
export type CategoryMappingConfidenceValue =
  (typeof categoryMappingConfidenceEnum.enumValues)[number];

export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type ProductRevisionRow = typeof productRevisions.$inferSelect;
export type NewProductRevisionRow = typeof productRevisions.$inferInsert;
export type ProductOptionRow = typeof productOptions.$inferSelect;
export type ProductOptionValueRow = typeof productOptionValues.$inferSelect;
export type ProductVariantRow = typeof productVariants.$inferSelect;
export type NewProductVariantRow = typeof productVariants.$inferInsert;
export type ProductVariantOptionValueRow =
  typeof productVariantOptionValues.$inferSelect;
export type ProviderProductReferenceRow =
  typeof providerProductReferences.$inferSelect;
export type ProviderVariantReferenceRow =
  typeof providerVariantReferences.$inferSelect;
export type ProductOfferRow = typeof productOffers.$inferSelect;
export type NewProductOfferRow = typeof productOffers.$inferInsert;
export type OfferSupplierBindingRow = typeof offerSupplierBindings.$inferSelect;
export type ProductMediaSourceRow = typeof productMediaSources.$inferSelect;
