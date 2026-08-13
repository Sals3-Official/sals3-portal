import type { Executor } from '@/modules/catalog/candidates/repository';
import {
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
  findActiveCategoryPolicy,
  findActiveFundingBufferPolicy,
  findActiveProductOverride,
  findActiveVariantOverride,
  findCategoryByCode,
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
 * Resolves product-only price guidance from category → product override →
 * variant override (ADR-015 §3), always applying the seller's own funding
 * buffer on top of the platform reference rate (ADR-015 §4) — a real,
 * unconditional cost-basis uplift, not gated on a buyer-settlement
 * currency mismatch. Server-side only — never
 * trusts a browser-supplied margin, rate, cost, or policy id (this function
 * takes exactly one caller-controlled input, `supplierCost`, and treats it
 * as evidence to validate, not as something to price directly).
 *
 * Fails closed with a specific, user-readable reason rather than falling
 * back to 0%, a global margin, a stale rate, or a demo value — every branch
 * below returns before doing arithmetic on data it could not verify.
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

  const category = await findCategoryByCode(executor, input.categoryCode);

  if (category === null) {
    return unavailable('CATEGORY_NOT_FOUND');
  }

  const categoryPolicy = await findActiveCategoryPolicy(
    executor,
    input.sellerAccountId,
    category.id,
  );

  if (categoryPolicy === null) {
    return unavailable('CATEGORY_POLICY_REQUIRED');
  }

  let resolvedLayer: ResolvedPolicyLayer = 'CATEGORY';
  let { targetMarginRate } = categoryPolicy;
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

  const roundedMinor = applyRounding(
    suggestedMinor,
    categoryPolicy.roundingRule,
  );

  return {
    outcome: 'PRODUCT_MARGIN_ESTIMATE',
    resolvedLayer,
    categoryCode: category.code,
    categoryPath: category.path,
    targetMarginRate,
    roundingRule: categoryPolicy.roundingRule,
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
      amountMinor: Number(suggestedMinor),
      currency: input.settlementCurrency,
    },
    roundedSuggestedItemPrice: {
      amountMinor: Number(roundedMinor),
      currency: input.settlementCurrency,
    },
    categoryPolicyId: categoryPolicy.id,
    categoryPolicyVersion: categoryPolicy.version,
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
