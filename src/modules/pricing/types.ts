import type { RoundingRule } from './money-math';

/** Integer minor units plus the ISO currency they are denominated in — same shape as the Product Editor's `MoneyValue`, defined fresh here so this server module never imports a client-safe UI module. */
export type Money = {
  amountMinor: number;
  currency: string;
};

/** ADR-002's four confidence states. The resolver refuses to price `AMBIGUOUS`/`UNMAPPED` — see `CATEGORY_MAPPING_REQUIRES_REVIEW`. */
export type CategoryMappingConfidence =
  'EXACT' | 'ACCEPTABLE' | 'AMBIGUOUS' | 'UNMAPPED';

export type ResolvedPolicyLayer =
  'STORE_DEFAULT' | 'CATEGORY' | 'PRODUCT_OVERRIDE' | 'VARIANT_OVERRIDE';

export type PricingUnavailableReason =
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_MAPPING_REQUIRES_REVIEW'
  | 'CATEGORY_POLICY_REQUIRED'
  | 'PRICING_POLICY_REQUIRED'
  | 'MARKET_REQUIRED'
  | 'CONTRIBUTION_FLOOR_CURRENCY_MISMATCH'
  | 'SUPPLIER_COST_UNAVAILABLE'
  | 'REFERENCE_FX_UNAVAILABLE'
  | 'FUNDING_BUFFER_REQUIRED'
  | 'FUNDING_BUFFER_EXPIRED'
  | 'INVALID_MARGIN_RATE';

export const PRICING_UNAVAILABLE_REASON_LABELS: Record<
  PricingUnavailableReason,
  string
> = {
  CATEGORY_NOT_FOUND: 'Category not found',
  CATEGORY_MAPPING_REQUIRES_REVIEW: 'Category mapping requires review',
  /** Legacy (resolver v2) — kept so decisions stored before v3 still render. v3 emits PRICING_POLICY_REQUIRED instead. */
  CATEGORY_POLICY_REQUIRED: 'Category policy required',
  PRICING_POLICY_REQUIRED:
    'No margin policy — set a store default or a category margin in Market rules',
  /**
   * Names the caller's omission, not the seller's. A seller cannot fix this by
   * configuring anything, so the copy must not send them to Market rules the
   * way `PRICING_POLICY_REQUIRED` does.
   */
  MARKET_REQUIRED:
    'No destination was given, so this price could not be worked out',
  CONTRIBUTION_FLOOR_CURRENCY_MISMATCH:
    'Contribution floor currency does not match the settlement currency',
  SUPPLIER_COST_UNAVAILABLE: 'Supplier cost unavailable',
  REFERENCE_FX_UNAVAILABLE: 'Reference FX unavailable',
  FUNDING_BUFFER_REQUIRED: 'Funding buffer required',
  FUNDING_BUFFER_EXPIRED: 'Funding buffer expired',
  INVALID_MARGIN_RATE: 'Invalid margin rate',
};

/** Bumped whenever the resolver's formula or precedence changes, so a persisted/rendered decision can always be traced to the logic that produced it — same idiom as `POLICY_VERSION` in `rules/policy.ts`. Bumped to v3 (2026-08-19): nearest-ancestor category resolution, the store-default base layer, and the minimum-contribution floor — offers stamped v2 were priced by exact-category-only logic with no floor. */
export const PRICING_RESOLVER_VERSION = 'pricing-resolver-v3';

export type PricingResolutionInput = {
  sellerAccountId: string;
  categoryCode: string | null;
  categoryMappingConfidence: CategoryMappingConfidence;
  /** Present only when resolving for a specific sourced product; `null` for a category-only preview. */
  supplierCandidateId: string | null;
  /** Present only when resolving for a specific variant. Requires `supplierCandidateId`. */
  supplierVariantId: string | null;
  supplierCost: Money | null;
  supplierCostObservedAt: string | null;
  /** ADR-003 phase 1: always `'USD'` today. Passed in, never hardcoded inside the resolver, so a future multi-currency phase changes one caller-supplied value, not this module. */
  settlementCurrency: string;
  /**
   * The destination being priced for, as a two-letter code.
   *
   * **Required, and deliberately not defaulted.** ADR-015's
   * `Amendment — 2026-08-25`: a caller that cannot say which destination it is
   * pricing for must refuse rather than silently resolve the all-destinations
   * rule — same reasoning as `settlementCurrency` above and
   * `minContributionCurrency` in the schema. An inferred commercial input is one
   * nobody can audit later, and the failure it produces is a wrong price rather
   * than an error.
   *
   * Typed as `string` rather than an enum for the reason
   * `product_offers.market_code` records: the allowed set is resolved
   * server-side from the seller's own profile, and this module must not become
   * the place a destination list is hard-coded. The resolver validates the shape
   * and refuses `MARKET_REQUIRED` on anything else.
   */
  marketCode: string;
};

export type PricingDecision =
  | {
      outcome: 'PRODUCT_MARGIN_ESTIMATE';
      resolvedLayer: ResolvedPolicyLayer;
      categoryCode: string;
      categoryPath: string;
      /**
       * The category the winning category policy is actually attached to —
       * the product's own category or its nearest priced ancestor. `null`
       * when the store default resolved (no priced node anywhere on the
       * chain). ADR-015 §3 requires precedence to be recorded, not just
       * applied.
       */
      policySourceCategoryCode: string | null;
      policySourceCategoryPath: string | null;
      targetMarginRate: string;
      roundingRule: RoundingRule;
      referenceFxRate: string;
      referenceFxSource: string;
      referenceFxObservedAt: string;
      fundingBufferRate: string;
      fundingBufferPolicyId: string;
      fundingBufferPolicyVersion: number;
      effectiveProductCost: Money;
      suggestedItemPrice: Money;
      roundedSuggestedItemPrice: Money;
      /** `null` when the store default is the resolving base — no category policy exists on the chain. */
      categoryPolicyId: string | null;
      categoryPolicyVersion: number | null;
      storeDefaultPolicyId: string | null;
      storeDefaultPolicyVersion: number | null;
      /** The seller's minimum contribution floor, when a store default carries one; `null` when no store default exists. */
      minContribution: Money | null;
      /** True when `cost + floor` beat the percentage price — the floor, not the margin rate, set this suggestion. */
      contributionFloorApplied: boolean;
      productOverrideId: string | null;
      productOverrideVersion: number | null;
      variantOverrideId: string | null;
      variantOverrideVersion: number | null;
      supplierCostObservedAt: string;
      resolverVersion: string;
      /** "This is product-only price guidance; checkout freight is not included." Never claims net profit or a full order margin. */
      scopeNote: string;
    }
  | {
      outcome: 'PRICING_UNAVAILABLE';
      reason: PricingUnavailableReason;
      reasonLabel: string;
      resolverVersion: string;
    };
