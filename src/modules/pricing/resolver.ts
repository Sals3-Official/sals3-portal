import type { Executor } from '@/modules/catalog/candidates/repository';
import type { FundingRail as SchemaFundingRail } from '@/lib/db/schema';
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
  findActiveFxAdjustmentPolicy,
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
 * variant override (ADR-015 §3), applying the seller's own FX adjustment on
 * top of the platform reference rate (ADR-015 §4). Server-side only — never
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

  let effectiveRateScaled = referenceRate.rateScaled;
  let fxAdjustmentRate: string | null = null;
  let fxAdjustmentPolicyId: string | null = null;
  let fxAdjustmentPolicyVersion: number | null = null;

  const needsFxAdjustment =
    input.supplierCost.currency !== input.settlementCurrency;

  if (needsFxAdjustment) {
    if (input.fundingRail === null) {
      return unavailable('FX_ADJUSTMENT_POLICY_REQUIRED');
    }

    const fxPolicy = await findActiveFxAdjustmentPolicy(
      executor,
      input.sellerAccountId,
      input.supplierCost.currency,
      input.settlementCurrency,
      input.fundingRail as SchemaFundingRail,
    );

    if (fxPolicy === null) {
      return unavailable('FX_ADJUSTMENT_POLICY_REQUIRED');
    }

    if (fxPolicy.effectiveTo !== null && fxPolicy.effectiveTo < new Date()) {
      return unavailable('POLICY_EXPIRED');
    }

    const adjustmentRateScaled = parseScaledRate(fxPolicy.adjustmentRate);

    effectiveRateScaled = applyFxAdjustment(
      referenceRate.rateScaled,
      adjustmentRateScaled,
    );
    fxAdjustmentRate = fxPolicy.adjustmentRate;
    fxAdjustmentPolicyId = fxPolicy.id;
    fxAdjustmentPolicyVersion = fxPolicy.version;
  }

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
    fxAdjustmentRate,
    fxAdjustmentPolicyId,
    fxAdjustmentPolicyVersion,
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
