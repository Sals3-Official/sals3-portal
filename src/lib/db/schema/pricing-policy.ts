import {
  bigint,
  check,
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
 * vault — see `src/lib/db/seed-data/sals3-taxonomy-v1.json` and
 * `scripts/seed-sals3-taxonomy-v1.mts`. `code` is the stable
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
    /**
     * The destination this rule prices for, or `null` for "all destinations".
     *
     * ADR-015's `Amendment — 2026-08-25`: operational expense is not the same
     * number in every country, so one rate cannot serve six. A 300 g basket
     * costs $3.70 to the Philippines and $16.01 to Fiji, while a 25% margin on
     * a $4.29 supplier cost contributes about $1.07 — covering neither.
     *
     * **Null is the unscoped rule, not a missing value.** Every policy written
     * before this column existed is therefore still exactly what it was, and no
     * backfill is required to preserve behaviour.
     *
     * Free text with a shape check rather than an enum, for the reason
     * `product_offers.market_code` already records: the allowed set is resolved
     * server-side from the seller's own `seller_market_profiles` row
     * intersected with `modules/market-config/capabilities.ts`, and encoding
     * today's pilot destinations as a Postgres enum would need a migration
     * every time the policy moves.
     */
    marketCode: text('market_code'),
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
    /**
     * Deterministic selection, in **two** partial indexes rather than one.
     *
     * Adding `market_code` to the original
     * `(seller_account_id, category_id)` index would have silently destroyed
     * the guarantee it existed for: Postgres treats NULLs as distinct in a
     * unique index, so two ACTIVE all-destinations policies for one category
     * would both have been accepted and the resolver would have had no
     * deterministic row to choose. Splitting on `market_code IS NULL` keeps
     * "at most one ACTIVE" true on both sides of the scope.
     *
     * `NULLS NOT DISTINCT` would express the same thing in one index. It is not
     * used because it is a Postgres 15+ behaviour switch that reads as a
     * detail, while this is the invariant the whole resolution order rests on.
     */
    uniqueIndex('pricing_category_policies_active_all_markets_key')
      .on(table.sellerAccountId, table.categoryId)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.marketCode} IS NULL`),
    uniqueIndex('pricing_category_policies_active_market_key')
      .on(table.sellerAccountId, table.categoryId, table.marketCode)
      .where(
        sql`${table.status} = 'ACTIVE' AND ${table.marketCode} IS NOT NULL`,
      ),
    index('pricing_category_policies_seller_idx').on(table.sellerAccountId),
    /** Same shape `product_offers` enforces. A CHECK passes on NULL. */
    check(
      'pricing_category_policies_market_code_shape',
      sql`${table.marketCode} IS NULL OR ${table.marketCode} ~ '^[A-Z]{2}$'`,
    ),
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
 * Seller-owned funding buffer (ADR-015 §4) — a flat, seller-owned
 * cost-basis uplift, deliberately separate from margin and from
 * `reference-fx.ts`'s buyer-settlement identity rate. Models the owner's
 * real funding-conversion exposure (e.g. converting AUD to top up a
 * CJ Wallet that only accepts USD/EUR) rather than a buyer-facing
 * currency-pair conversion — see `src/modules/pricing/resolver.ts`'s
 * unconditional funding-buffer step. At most one ACTIVE row per seller;
 * there is no currency pair or funding rail dimension. `effectiveTo` is
 * nullable (open-ended) but when set makes the policy provably temporary
 * per ADR-015 §5 ("temporary overrides require start/end time or a review
 * date").
 */
export const pricingFxAdjustmentPolicies = pgTable(
  'pricing_fx_adjustment_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),
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
    // At most one ACTIVE funding buffer per seller — no currency/rail dimension.
    uniqueIndex('pricing_fx_adjustment_policies_active_key')
      .on(table.sellerAccountId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('pricing_fx_adjustment_policies_seller_idx').on(
      table.sellerAccountId,
    ),
  ],
);

/**
 * Store-wide default pricing (ADR-015 §3's "seller/store default" layer,
 * built 2026-08-19). The base of the resolution chain: a product whose
 * category chain carries no policy prices from this row instead of failing
 * `CATEGORY_POLICY_REQUIRED` — 21 department policies plus one of these can
 * cover the whole 5,595-row taxonomy without per-category fan-out.
 *
 * That fallback is now optional, and in practice unused: the 21 departments
 * all carry markups, so `targetMarginRate` is null and the row's remaining job
 * is the floor. See the column's own comment for why null and zero are not the
 * same answer.
 *
 * `minContributionMinor` is ADR-015 §1's named-but-previously-unbuilt
 * "minimum contribution profit": an absolute per-item floor above effective
 * cost, in minor units of `minContributionCurrency`. The resolver takes
 * `max(marginPrice, cost + floor)` — a percentage alone loses money on
 * cheap items where fixed per-order costs dominate, and a floor alone
 * undercharges expensive ones. Zero means "no floor", a real, deliberate
 * value distinct from no row at all.
 *
 * Same append-only-by-edit versioning discipline as every policy table in
 * this module — see the module doc comment.
 */
export const pricingStoreDefaults = pgTable(
  'pricing_store_defaults',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),
    /**
     * The markup for a product whose category chain has no rule of its own,
     * or `null` for "this seller has no such fallback".
     *
     * Nullable since 2026-08-28. This is the only column on the row the
     * resolver reads *conditionally* — `nearestCategoryPolicy === null` in
     * `resolveProductPricing`, and nowhere else. Every category on this
     * account carries its own markup, so that branch never runs; the floor
     * columns below, read for every product whichever layer priced it, are
     * what the row now exists to hold. Requiring a number nobody wanted in
     * order to state one they did is what made the editing screen unreadable.
     *
     * **Null is not zero.** Zero is a rule that prices at cost. Null is the
     * absence of a rule, and a product whose category also has no markup then
     * has no price at all (`PRICING_POLICY_REQUIRED`) rather than a silently
     * free one.
     */
    targetMarginRate: numeric('target_margin_rate', {
      precision: 8,
      scale: 6,
    }),
    /** Absolute per-item contribution floor in minor units; 0 = no floor. */
    minContributionMinor: bigint('min_contribution_minor', {
      mode: 'bigint',
    })
      .notNull()
      .default(sql`0`),
    /** Currency the floor is denominated in — explicit per ADR-015 §1, never inferred. */
    minContributionCurrency: text('min_contribution_currency')
      .notNull()
      .default('USD'),
    /**
     * The same floor expressed as a margin instead of an amount, or `null`.
     *
     * Owner rule 2026-08-26: a margin must never fall below what it costs to
     * operate, and that minimum is either a percentage or a fixed amount —
     * never both on one rule. `pricing_store_defaults_floor_exclusive` refuses
     * a row carrying both, so the resolver can never be handed two answers.
     *
     * Read as `price >= cost / (1 - rate)`, the same formula
     * `targetMarginRate` uses, so the two are directly comparable — a floor of
     * 0.18 genuinely means "never below 18% margin", not "18% on top of cost".
     *
     * Distinct from `targetMarginRate` on purpose: that is what the rule aims
     * for, this is what it must never fall below. A seller may aim for 25% and
     * refuse to go under 18%, and one column cannot say both.
     *
     * Needs no currency, unlike `minContributionMinor` — which is why it is the
     * safer of the two forms once the storefront starts settling in the buyer's
     * own currency.
     */
    minContributionRate: numeric('min_contribution_rate', {
      precision: 8,
      scale: 6,
    }),
    /**
     * The destination this rule prices for, or `null` for "all destinations".
     *
     * ADR-015's `Amendment — 2026-08-25`: operational expense is not the same
     * number in every country, so one rate cannot serve six. A 300 g basket
     * costs $3.70 to the Philippines and $16.01 to Fiji, while a 25% margin on
     * a $4.29 supplier cost contributes about $1.07 — covering neither.
     *
     * **Null is the unscoped rule, not a missing value.** Every policy written
     * before this column existed is therefore still exactly what it was, and no
     * backfill is required to preserve behaviour.
     *
     * Free text with a shape check rather than an enum, for the reason
     * `product_offers.market_code` already records: the allowed set is resolved
     * server-side from the seller's own `seller_market_profiles` row
     * intersected with `modules/market-config/capabilities.ts`, and encoding
     * today's pilot destinations as a Postgres enum would need a migration
     * every time the policy moves.
     */
    marketCode: text('market_code'),
    roundingRule: roundingRuleEnum('rounding_rule').notNull().default('NONE'),
    status: pricingPolicyStatusEnum('status').notNull().default('ACTIVE'),
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
    /**
     * At most one ACTIVE store default per seller **per scope** — same
     * two-index reasoning as `pricing_category_policies` above, and the same
     * NULL-distinctness trap avoided the same way.
     *
     * The floor travels with the margin here on purpose. The owner's
     * justification for per-destination pricing was operational expense, and
     * `min_contribution_minor` is the instrument that carries exactly that:
     * the cost that does not shrink when an item is cheap. Scoping the margin
     * without scoping the floor would have moved half the rule.
     */
    uniqueIndex('pricing_store_defaults_active_all_markets_key')
      .on(table.sellerAccountId)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.marketCode} IS NULL`),
    uniqueIndex('pricing_store_defaults_active_market_key')
      .on(table.sellerAccountId, table.marketCode)
      .where(
        sql`${table.status} = 'ACTIVE' AND ${table.marketCode} IS NOT NULL`,
      ),
    index('pricing_store_defaults_seller_idx').on(table.sellerAccountId),
    check(
      'pricing_store_defaults_market_code_shape',
      sql`${table.marketCode} IS NULL OR ${table.marketCode} ~ '^[A-Z]{2}$'`,
    ),
    /**
     * One floor form per rule, or neither.
     *
     * Written against `> 0` rather than `IS NOT NULL` because
     * `minContributionMinor` is NOT NULL DEFAULT 0 — "no amount floor" is zero
     * here, and a check phrased against NULL would admit exactly the rows it
     * exists to refuse.
     */
    check(
      'pricing_store_defaults_floor_exclusive',
      sql`NOT (${table.minContributionRate} IS NOT NULL AND ${table.minContributionMinor} > 0)`,
    ),
    /**
     * `price = cost / (1 - rate)` divides by zero at 1 and prices nothing at 0.
     * Both are typos, and a typo belongs refused rather than stored as a rule
     * that can only ever fail.
     */
    check(
      'pricing_store_defaults_floor_rate_range',
      sql`${table.minContributionRate} IS NULL OR (${table.minContributionRate} > 0 AND ${table.minContributionRate} < 1)`,
    ),
  ],
);

export type RoundingRule = (typeof roundingRuleEnum.enumValues)[number];

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
export type PricingStoreDefaultRow = typeof pricingStoreDefaults.$inferSelect;
export type NewPricingStoreDefaultRow =
  typeof pricingStoreDefaults.$inferInsert;
