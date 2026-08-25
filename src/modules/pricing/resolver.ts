import type { Executor } from '@/modules/catalog/candidates/repository';
import {
  applyContributionFloor,
  marginFloorMinor,
  applyFxAdjustment,
  applyRounding,
  convertAmountMinor,
  formatScaledRate,
  isValidMarginRate,
  parseScaledRate,
  RATE_SCALE,
  suggestedPriceMinor as computeSuggestedPriceMinor,
} from './money-math';
import { resolveReferenceFxRate } from './reference-fx';
import {
  findActiveFundingBufferPolicy,
  findActiveProductOverride,
  findActiveStoreDefault,
  findActiveVariantOverride,
  findCategoryByCode,
  findNearestActiveCategoryPolicy,
} from './repository';
import {
  PRICING_RESOLVER_VERSION,
  PRICING_UNAVAILABLE_REASON_LABELS,
  type PricingDecision,
  type PricingResolutionInput,
  type PricingUnavailableReason,
  type ResolvedPolicyLayer,
} from './types';

const SCOPE_NOTE =
  'This is product-only price guidance; checkout freight is not included.';

function unavailable(reason: PricingUnavailableReason): PricingDecision {
  return {
    outcome: 'PRICING_UNAVAILABLE',
    reason,
    reasonLabel: PRICING_UNAVAILABLE_REASON_LABELS[reason],
    resolverVersion: PRICING_RESOLVER_VERSION,
  };
}

/**
 * Resolves product-only price guidance through ADR-015 §3's
 * least-to-most-specific chain (v3, 2026-08-19 amendment):
 *
 *   store default → nearest-ancestor category policy → product override
 *   → variant override
 *
 * Two v3 changes over the exact-category-only v2:
 *
 * - **Nearest-ancestor category resolution.** Taxonomy v1 stores a row for
 *   every node, so a policy set on "Apparel & Accessories" prices every
 *   product anywhere under it unless a deeper node (or the product's own
 *   category) carries its own. 21 department policies plus one store
 *   default can cover the whole 5,595-row taxonomy — the per-leaf fan-out
 *   this replaces wrote 5,595 rows per seller and silently missed any
 *   category added later.
 * - **Minimum contribution floor** (ADR-015 §1's named input, previously
 *   unbuilt): `max(marginPrice, cost + floor)`. A percentage alone loses
 *   money on cheap items where fixed per-order costs dominate; the floor
 *   alone would undercharge expensive ones. The floor lives on the store
 *   default and applies whichever layer supplied the margin.
 *
 * The seller's funding buffer still applies unconditionally on top of the
 * platform reference rate (ADR-015 §4) — a real cost-basis uplift, never
 * gated on a currency mismatch. Server-side only — this function takes
 * exactly one caller-controlled input, `supplierCost`, and treats it as
 * evidence to validate, not as something to price directly.
 *
 * Fails closed with a specific, user-readable reason rather than falling
 * back to 0%, a global margin, a stale rate, or a demo value — every
 * branch below returns before doing arithmetic on data it could not
 * verify.
 */
export async function resolveProductPricing(
  executor: Executor,
  input: PricingResolutionInput,
): Promise<PricingDecision> {
  if (
    input.categoryCode === null ||
    input.categoryMappingConfidence === 'AMBIGUOUS' ||
    input.categoryMappingConfidence === 'UNMAPPED'
  ) {
    return unavailable('CATEGORY_MAPPING_REQUIRES_REVIEW');
  }

  /**
   * Refused before any read, not defaulted.
   *
   * Both policy tables now carry a destination scope, and an unscoped rule is a
   * real configuration meaning "all destinations" rather than an absence. So a
   * caller that cannot name its destination cannot be quietly given the
   * unscoped answer: that would price a Fiji order off a rule the seller wrote
   * for everywhere, and produce a number instead of an error.
   *
   * Shape-checked here against the same `^[A-Z]{2}$` the database enforces, so
   * a typo is a refusal rather than a silent miss — `market_code = 'aus'`
   * matches no row and would otherwise fall through to the unscoped rule
   * looking exactly like success.
   */
  if (!/^[A-Z]{2}$/.test(input.marketCode)) {
    return unavailable('MARKET_REQUIRED');
  }

  const category = await findCategoryByCode(executor, input.categoryCode);

  if (category === null) {
    return unavailable('CATEGORY_NOT_FOUND');
  }

  const nearestCategoryPolicy = await findNearestActiveCategoryPolicy(
    executor,
    input.sellerAccountId,
    category,
    input.marketCode,
  );

  // Fetched even when a category policy exists: the store default is the
  // only carrier of the contribution floor, and the rounding fallback when
  // the chain has no policy.
  const storeDefault = await findActiveStoreDefault(
    executor,
    input.sellerAccountId,
    input.marketCode,
  );

  if (nearestCategoryPolicy === null && storeDefault === null) {
    return unavailable('PRICING_POLICY_REQUIRED');
  }

  let resolvedLayer: ResolvedPolicyLayer =
    nearestCategoryPolicy === null ? 'STORE_DEFAULT' : 'CATEGORY';
  let targetMarginRate =
    nearestCategoryPolicy === null
      ? // `storeDefault` cannot be null here — the guard above returned.
        (storeDefault as NonNullable<typeof storeDefault>).targetMarginRate
      : nearestCategoryPolicy.policy.targetMarginRate;

  // Rounding belongs to the nearest category policy when one exists, else
  // the store default — an override wins the margin but never silently
  // changes how a whole category rounds (unchanged v2 behaviour, extended
  // to the new base layer).
  const roundingRule =
    nearestCategoryPolicy?.policy.roundingRule ??
    (storeDefault as NonNullable<typeof storeDefault>).roundingRule;

  let productOverrideId: string | null = null;
  let productOverrideVersion: number | null = null;
  let variantOverrideId: string | null = null;
  let variantOverrideVersion: number | null = null;

  if (input.supplierCandidateId !== null) {
    const productOverride = await findActiveProductOverride(
      executor,
      input.supplierCandidateId,
    );

    if (productOverride !== null) {
      resolvedLayer = 'PRODUCT_OVERRIDE';
      targetMarginRate = productOverride.targetMarginRate;
      productOverrideId = productOverride.id;
      productOverrideVersion = productOverride.version;
    }

    if (input.supplierVariantId !== null) {
      const variantOverride = await findActiveVariantOverride(
        executor,
        input.supplierCandidateId,
        input.supplierVariantId,
      );

      if (variantOverride !== null) {
        resolvedLayer = 'VARIANT_OVERRIDE';
        targetMarginRate = variantOverride.targetMarginRate;
        variantOverrideId = variantOverride.id;
        variantOverrideVersion = variantOverride.version;
      }
    }
  }

  let marginRateScaled: bigint;

  try {
    marginRateScaled = parseScaledRate(targetMarginRate);
  } catch {
    return unavailable('INVALID_MARGIN_RATE');
  }

  if (!isValidMarginRate(marginRateScaled)) {
    return unavailable('INVALID_MARGIN_RATE');
  }

  if (input.supplierCost === null) {
    return unavailable('SUPPLIER_COST_UNAVAILABLE');
  }

  const referenceRate = resolveReferenceFxRate(
    input.supplierCost.currency,
    input.settlementCurrency,
  );

  if (referenceRate === null) {
    return unavailable('REFERENCE_FX_UNAVAILABLE');
  }

  // Unconditional: every dollar of supplier cost was originally converted
  // from the seller's own funding currency (e.g. AUD topping up a CJ
  // Wallet that only accepts USD/EUR), regardless of whether this
  // resolution's settlement currency happens to match the supplier cost
  // currency. This is a distinct step from the reference-FX conversion
  // above — never merge a buyer-settlement conversion with the seller's
  // own funding-cost buffer (ADR-015 §4).
  const bufferPolicy = await findActiveFundingBufferPolicy(
    executor,
    input.sellerAccountId,
  );

  if (bufferPolicy === null) {
    return unavailable('FUNDING_BUFFER_REQUIRED');
  }

  if (
    bufferPolicy.effectiveTo !== null &&
    bufferPolicy.effectiveTo < new Date()
  ) {
    return unavailable('FUNDING_BUFFER_EXPIRED');
  }

  const bufferRateScaled = parseScaledRate(bufferPolicy.adjustmentRate);

  const effectiveRateScaled = applyFxAdjustment(
    referenceRate.rateScaled,
    bufferRateScaled,
  );

  const effectiveProductCostMinor = convertAmountMinor(
    input.supplierCost.amountMinor,
    effectiveRateScaled,
  );

  let suggestedMinor: bigint;

  try {
    suggestedMinor = computeSuggestedPriceMinor(
      effectiveProductCostMinor,
      marginRateScaled,
    );
  } catch {
    return unavailable('INVALID_MARGIN_RATE');
  }

  /*
    The operating-expense floor lives on the store default, in one of two
    forms — a minimum margin, or a minimum cash contribution per item. Owner
    rule 2026-08-26: never both on one rule, enforced by
    `pricing_store_defaults_floor_exclusive`, so this reads whichever is set
    rather than reconciling two answers.

    The rate form needs no currency. The amount form does, and a floor in a
    currency the settlement currency cannot be compared against fails closed —
    converting at an invented rate is the flat-markup failure ADR-003
    prohibits. A seller with no store default simply has no floor.
  */
  let minContributionMinor = BigInt(0);
  let floorFromRateMinor = BigInt(0);

  if (storeDefault !== null && storeDefault.minContributionRate !== null) {
    let floorRateScaled: bigint;

    try {
      floorRateScaled = parseScaledRate(storeDefault.minContributionRate);
    } catch {
      return unavailable('INVALID_MARGIN_RATE');
    }

    try {
      floorFromRateMinor = marginFloorMinor(
        effectiveProductCostMinor,
        floorRateScaled,
      );
    } catch {
      // A rate outside the open interval predates
      // `pricing_store_defaults_floor_rate_range`. Refuse rather than quote a
      // price computed from a rule the database would no longer accept.
      return unavailable('INVALID_MARGIN_RATE');
    }
  } else if (
    storeDefault !== null &&
    storeDefault.minContributionMinor > BigInt(0)
  ) {
    if (storeDefault.minContributionCurrency !== input.settlementCurrency) {
      return unavailable('CONTRIBUTION_FLOOR_CURRENCY_MISMATCH');
    }
    minContributionMinor = storeDefault.minContributionMinor;
  }

  const contributionFlooredMinor = applyContributionFloor(
    suggestedMinor,
    effectiveProductCostMinor,
    minContributionMinor,
  );
  const flooredMinor =
    floorFromRateMinor > contributionFlooredMinor
      ? floorFromRateMinor
      : contributionFlooredMinor;
  const contributionFloorApplied = flooredMinor > suggestedMinor;

  const roundedMinor = applyRounding(flooredMinor, roundingRule);

  return {
    outcome: 'PRODUCT_MARGIN_ESTIMATE',
    resolvedLayer,
    categoryCode: category.code,
    categoryPath: category.path,
    policySourceCategoryCode:
      nearestCategoryPolicy?.sourceCategory.code ?? null,
    policySourceCategoryPath:
      nearestCategoryPolicy?.sourceCategory.path ?? null,
    targetMarginRate,
    roundingRule,
    referenceFxRate: formatScaledRate(referenceRate.rateScaled),
    referenceFxSource: referenceRate.source,
    referenceFxObservedAt: referenceRate.observedAt,
    fundingBufferRate: bufferPolicy.adjustmentRate,
    fundingBufferPolicyId: bufferPolicy.id,
    fundingBufferPolicyVersion: bufferPolicy.version,
    effectiveProductCost: {
      amountMinor: Number(effectiveProductCostMinor),
      currency: input.settlementCurrency,
    },
    suggestedItemPrice: {
      amountMinor: Number(flooredMinor),
      currency: input.settlementCurrency,
    },
    roundedSuggestedItemPrice: {
      amountMinor: Number(roundedMinor),
      currency: input.settlementCurrency,
    },
    categoryPolicyId: nearestCategoryPolicy?.policy.id ?? null,
    categoryPolicyVersion: nearestCategoryPolicy?.policy.version ?? null,
    storeDefaultPolicyId: storeDefault?.id ?? null,
    storeDefaultPolicyVersion: storeDefault?.version ?? null,
    minContribution:
      storeDefault === null
        ? null
        : {
            amountMinor: Number(storeDefault.minContributionMinor),
            currency: storeDefault.minContributionCurrency,
          },
    contributionFloorApplied,
    productOverrideId,
    productOverrideVersion,
    variantOverrideId,
    variantOverrideVersion,
    supplierCostObservedAt:
      input.supplierCostObservedAt ?? new Date(0).toISOString(),
    resolverVersion: PRICING_RESOLVER_VERSION,
    scopeNote: SCOPE_NOTE,
  };
}

export { RATE_SCALE };
