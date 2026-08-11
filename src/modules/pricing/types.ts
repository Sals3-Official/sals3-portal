import type { RoundingRule } from './money-math';

/** Integer minor units plus the ISO currency they are denominated in — same shape as the Product Editor's `MoneyValue`, defined fresh here so this server module never imports a client-safe UI module. */
export type Money = {
  amountMinor: number;
  currency: string;
};

/** ADR-002's four confidence states. The resolver refuses to price `AMBIGUOUS`/`UNMAPPED` — see `CATEGORY_MAPPING_REQUIRES_REVIEW`. */
export type CategoryMappingConfidence =
  'EXACT' | 'ACCEPTABLE' | 'AMBIGUOUS' | 'UNMAPPED';

export type FundingRail =
  'CJ_WALLET_WIRE_TRANSFER' | 'CJ_WALLET_PAYONEER' | 'OTHER';

export type ResolvedPolicyLayer =
  'CATEGORY' | 'PRODUCT_OVERRIDE' | 'VARIANT_OVERRIDE';

export type PricingUnavailableReason =
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_MAPPING_REQUIRES_REVIEW'
  | 'CATEGORY_POLICY_REQUIRED'
  | 'SUPPLIER_COST_UNAVAILABLE'
  | 'REFERENCE_FX_UNAVAILABLE'
  | 'FX_ADJUSTMENT_POLICY_REQUIRED'
  | 'POLICY_EXPIRED'
  | 'INVALID_MARGIN_RATE';

export const PRICING_UNAVAILABLE_REASON_LABELS: Record<
  PricingUnavailableReason,
  string
> = {
  CATEGORY_NOT_FOUND: 'Category not found',
  CATEGORY_MAPPING_REQUIRES_REVIEW: 'Category mapping requires review',
  CATEGORY_POLICY_REQUIRED: 'Category policy required',
  SUPPLIER_COST_UNAVAILABLE: 'Supplier cost unavailable',
  REFERENCE_FX_UNAVAILABLE: 'Reference FX unavailable',
  FX_ADJUSTMENT_POLICY_REQUIRED: 'FX adjustment policy required',
  POLICY_EXPIRED: 'Policy expired',
  INVALID_MARGIN_RATE: 'Invalid margin rate',
};

/** Bumped whenever the resolver's formula or precedence changes, so a persisted/rendered decision can always be traced to the logic that produced it — same idiom as `POLICY_VERSION` in `rules/policy.ts`. */
export const PRICING_RESOLVER_VERSION = 'pricing-resolver-v1';

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
  fundingRail: FundingRail | null;
};

export type PricingDecision =
  | {
      outcome: 'PRODUCT_MARGIN_ESTIMATE';
      resolvedLayer: ResolvedPolicyLayer;
      categoryCode: string;
      categoryPath: string;
      targetMarginRate: string;
      roundingRule: RoundingRule;
      referenceFxRate: string;
      referenceFxSource: string;
      referenceFxObservedAt: string;
      fxAdjustmentRate: string | null;
      fxAdjustmentPolicyId: string | null;
      fxAdjustmentPolicyVersion: number | null;
      effectiveProductCost: Money;
      suggestedItemPrice: Money;
      roundedSuggestedItemPrice: Money;
      categoryPolicyId: string;
      categoryPolicyVersion: number;
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
