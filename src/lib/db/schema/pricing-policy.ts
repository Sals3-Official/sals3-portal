import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { supplierCandidates } from './catalog';
import { sellerAccounts } from './seller-accounts';

/**
 * Category-first manual margin and FX-adjustment policy (ADR-015 Phase 1).
 *
 * Every policy table below is append-only-by-edit: an edit never `UPDATE`s
 * the active row in place. It inserts a new row and marks the previous one
 * `SUPERSEDED` in the same transaction, so `version`/`supersedesId` give a
 * real, queryable history instead of a bare overwrite — see ADR-015 §5's
 * "no bare overwrite-only configuration with no audit trail". A partial
 * unique index (`WHERE status = 'ACTIVE'`) is what makes "the current
 * policy for X" a deterministic, database-enforced single row rather than
 * an application convention that concurrent writers could violate.
 *
 * `pricing_product_overrides`/`pricing_variant_overrides` are keyed by
 * `supplier_candidates.id`/a plain CJ variant-id string, NOT a `products`/
 * `product_variants` table — no such table exists anywhere in this
 * codebase yet (no Product/Variant/Offer model has been built). Anchoring
 * to the one real, persisted, tenant-scoped "this is a specific product a
 * seller is sourcing" identity that already exists is the same choice this
 * codebase already made for `supplier_candidates` itself ("Modelling them
 * before the flow that fills them would be schema for its own sake" -
 * `catalog.ts`). This will need a follow-up migration once a real Product
 * table exists; it is not a design this file pretends is final.
 */

export const taxonomyStatusEnum = pgEnum('taxonomy_status', [
  'ADOPTED',
  'PILOT_VALIDATED',
  'PRODUCTION_READY',
]);

/**
 * Sals3 Taxonomy v0 (ADR-002), seeded verbatim from
 * `docs/Raw/universal_category_variation_taxonomy.xlsx`'s
 * `Universal_Category_Taxonomy` sheet in the sibling `sals3-ecommerce`
 * vault — see `src/lib/db/seed-data/sals3-taxonomy-v0.json` and
 * `scripts/seed-sals3-taxonomy.mts`. `code` is the stable
 * "Universal Category Code" column; it is the ONLY column a commercial
 * policy may reference (never a display label, never a CJ category
 * string, never mutable path text). Global reference data, not
 * tenant-scoped — every seller reads the same taxonomy.
 */
export const sals3Categories = pgTable(
  'sals3_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    l1: text('l1'),
    l2: text('l2'),
    l3: text('l3'),
    l4: text('l4'),
    l5: text('l5'),
    path: text('path').notNull(),
    taxonomyStatus: taxonomyStatusEnum('taxonomy_status')
      .notNull()
      .default('ADOPTED'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('sals3_categories_code_key').on(table.code),
    index('sals3_categories_l1_idx').on(table.l1),
  ],
);

export const pricingPolicyStatusEnum = pgEnum('pricing_policy_status', [
  'ACTIVE',
  'SUPERSEDED',
  'DEACTIVATED',
]);

export const pricingOverrideStatusEnum = pgEnum('pricing_override_status', [
  'ACTIVE',
  'SUPERSEDED',
  'REMOVED',
]);

/** Charm-pricing (`NEAREST_0_99`) is a real merchant strategy, not a fabricated comparison price — see part31 research note §D. */
export const roundingRuleEnum = pgEnum('rounding_rule', [
  'NONE',
  'NEAREST_0_99',
]);

/**
 * Only the funding rails this codebase has actually documented (part31
 * research: CJ Wallet topped up by wire/Payoneer). `OTHER` exists so a
 * seller is never blocked from recording a real rail this enum has not
 * caught up to yet; it still requires the same reason/audit trail.
 */
export const fundingRailEnum = pgEnum('funding_rail', [
  'CJ_WALLET_WIRE_TRANSFER',
  'CJ_WALLET_PAYONEER',
  'OTHER',
]);

/**
 * Seller category margin policy — ADR-015's "normal operational default".
 * `targetMarginRate` is a `numeric` column (Drizzle returns it as a
 * `string`), never a JS `number`, so no floating-point value is ever the
 * source of truth for a rate used to price real products — see
 * `src/modules/pricing/money-math.ts` for the BigInt fixed-point math that
 * reads it.
 */
export const pricingCategoryPolicies = pgTable(
  'pricing_category_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => sals3Categories.id, { onDelete: 'restrict' }),
    /** 0 < rate < 1, enforced again at the write boundary (Zod) and defensively by the resolver. */
    targetMarginRate: numeric('target_margin_rate', {
      precision: 8,
      scale: 6,
    }).notNull(),
    roundingRule: roundingRuleEnum('rounding_rule').notNull().default('NONE'),
    status: pricingPolicyStatusEnum('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    /** The row this edit replaced. `null` for the first version. */
    supersedesId: uuid('supersedes_id'),
    reason: text('reason').notNull(),
    actorId: text('actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Deterministic selection: at most one ACTIVE policy per seller+category.
    uniqueIndex('pricing_category_policies_active_key')
      .on(table.sellerAccountId, table.categoryId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('pricing_category_policies_seller_idx').on(table.sellerAccountId),
  ],
);

/**
 * Explicit product-level exception to the category policy. Keyed by
 * `supplierCandidateId` — see module doc comment.
 */
export const pricingProductOverrides = pgTable(
  'pricing_product_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierCandidateId: uuid('supplier_candidate_id')
      .notNull()
      .references(() => supplierCandidates.id, { onDelete: 'restrict' }),
    targetMarginRate: numeric('target_margin_rate', {
      precision: 8,
      scale: 6,
    }).notNull(),
    status: pricingOverrideStatusEnum('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    reason: text('reason').notNull(),
    actorId: text('actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('pricing_product_overrides_active_key')
      .on(table.supplierCandidateId)
      .where(sql`${table.status} = 'ACTIVE'`),
  ],
);

/**
 * Exceptional variant-level override. `supplierVariantId` is a plain
 * CJ-supplied string (no variant table exists — see
 * `VariantFixture.supplierVariantId` in the Product Editor, same
 * convention). `additionalJustification` is a second, distinct required
 * field from `reason` because the turnover brief is explicit that a variant
 * override needs its own explanation beyond the usual reason: "intended
 * only for materially different cost/risk" — folding it into `reason`
 * would make that easy to skip.
 */
export const pricingVariantOverrides = pgTable(
  'pricing_variant_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierCandidateId: uuid('supplier_candidate_id')
      .notNull()
      .references(() => supplierCandidates.id, { onDelete: 'restrict' }),
    supplierVariantId: text('supplier_variant_id').notNull(),
    targetMarginRate: numeric('target_margin_rate', {
      precision: 8,
      scale: 6,
    }).notNull(),
    status: pricingOverrideStatusEnum('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    reason: text('reason').notNull(),
    additionalJustification: text('additional_justification').notNull(),
    actorId: text('actor_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('pricing_variant_overrides_active_key')
      .on(table.supplierCandidateId, table.supplierVariantId)
      .where(sql`${table.status} = 'ACTIVE'`),
  ],
);

/**
 * Seller-owned FX adjustment (ADR-015 §4) — deliberately separate from
 * margin and from the reference rate. Scoped by currency pair + funding
 * rail, never a category/product default. `effectiveTo` is nullable
 * (open-ended) but when set makes the policy provably temporary per
 * ADR-015 §5 ("temporary overrides require start/end time or a review
 * date").
 */
export const pricingFxAdjustmentPolicies = pgTable(
  'pricing_fx_adjustment_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),
    sourceCurrency: text('source_currency').notNull(),
    targetCurrency: text('target_currency').notNull(),
    fundingRail: fundingRailEnum('funding_rail').notNull(),
    /** Signed buffer, e.g. 0.025 = +2.5%. Not a margin, not a fee. */
    adjustmentRate: numeric('adjustment_rate', {
      precision: 8,
      scale: 6,
    }).notNull(),
    status: pricingPolicyStatusEnum('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    reason: text('reason').notNull(),
    actorId: text('actor_id').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('pricing_fx_adjustment_policies_active_key')
      .on(
        table.sellerAccountId,
        table.sourceCurrency,
        table.targetCurrency,
        table.fundingRail,
      )
      .where(sql`${table.status} = 'ACTIVE'`),
    index('pricing_fx_adjustment_policies_seller_idx').on(
      table.sellerAccountId,
    ),
  ],
);

export type RoundingRule = (typeof roundingRuleEnum.enumValues)[number];
export type FundingRail = (typeof fundingRailEnum.enumValues)[number];

export type Sals3CategoryRow = typeof sals3Categories.$inferSelect;
export type NewSals3CategoryRow = typeof sals3Categories.$inferInsert;
export type PricingCategoryPolicyRow =
  typeof pricingCategoryPolicies.$inferSelect;
export type NewPricingCategoryPolicyRow =
  typeof pricingCategoryPolicies.$inferInsert;
export type PricingProductOverrideRow =
  typeof pricingProductOverrides.$inferSelect;
export type NewPricingProductOverrideRow =
  typeof pricingProductOverrides.$inferInsert;
export type PricingVariantOverrideRow =
  typeof pricingVariantOverrides.$inferSelect;
export type NewPricingVariantOverrideRow =
  typeof pricingVariantOverrides.$inferInsert;
export type PricingFxAdjustmentPolicyRow =
  typeof pricingFxAdjustmentPolicies.$inferSelect;
export type NewPricingFxAdjustmentPolicyRow =
  typeof pricingFxAdjustmentPolicies.$inferInsert;
