import type { CandidateEvidence } from '@/lib/cj/evidence';
import type { EvidenceSummary, RuleFinding } from './contracts';
import {
  ABNORMAL_PRICE_CHANGE_PERCENT,
  COUNTERFEIT_SIGNAL_KEYWORDS,
  estimatedMarginPercent,
  MAX_PRICE_USD_CENTS,
  MIN_MARGIN_PERCENT,
  MIN_PRICE_USD_CENTS,
  PROTECTED_BRAND_DENYLIST,
} from './policy';

/**
 * Full qualification rules (spec's "run qualification rules" step) - run
 * against real CJ evidence (detail, variants, inventory, reviews) after a
 * candidate survives cheap screening. See `rules/policy.ts` for which
 * thresholds here are placeholders versus spec-sourced facts, and the plan's
 * rule-mapping table for checks that are out of scope or not implementable
 * from CJ's current API surface (image dimensions, category-required
 * attributes).
 */

function matchesKeyword(
  haystack: string,
  keywords: readonly string[],
): string | undefined {
  const lower = haystack.toLowerCase();

  return keywords.find((keyword) => lower.includes(keyword));
}

export function checkImages(evidence: CandidateEvidence): RuleFinding | null {
  if (evidence.usableImageCount === 0) {
    return {
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'BLOCK',
      detail: 'No usable, allow-listed product images',
    };
  }

  if (evidence.usableImageCount < 3) {
    return {
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'ATTENTION',
      detail: `Only ${evidence.usableImageCount} usable image(s); at least three is preferred`,
    };
  }

  return null;
}

export function checkVariants(evidence: CandidateEvidence): RuleFinding | null {
  if (evidence.variants.length === 0) {
    return {
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'BLOCK',
      detail: 'No variants returned for this product',
    };
  }

  const labels = evidence.variants.map((variant) => variant.optionLabel);
  const hasDuplicateLabel = new Set(labels).size !== labels.length;

  if (hasDuplicateLabel) {
    return {
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'ATTENTION',
      detail: 'Two or more variants share the same option label',
    };
  }

  return null;
}

function totalVariantStock(evidence: CandidateEvidence): number | null {
  const known = evidence.variants
    .map((variant) => variant.totalInventory)
    .filter((value): value is number => value !== null);

  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0);
}

export function checkStock(evidence: CandidateEvidence): RuleFinding | null {
  const total = totalVariantStock(evidence);

  if (total === null || total <= 0) {
    return {
      reasonCode: 'NO_STOCK',
      severity: 'BLOCK',
      detail: 'CJ reports zero stock across every variant',
    };
  }

  return null;
}

export function checkShippingRoute(
  evidence: CandidateEvidence,
): RuleFinding | null {
  const anyWarehouseStocked = evidence.warehouses.some(
    (warehouse) => (warehouse.totalInventory ?? 0) > 0,
  );

  if (!anyWarehouseStocked) {
    return {
      reasonCode: 'NO_SHIPPING_ROUTE',
      severity: 'BLOCK',
      detail: 'No warehouse reports any stock, so no shipping origin exists',
    };
  }

  return null;
}

export function checkCounterfeitSignalFull(
  evidence: CandidateEvidence,
): RuleFinding | null {
  const brandMatch = matchesKeyword(evidence.name, PROTECTED_BRAND_DENYLIST);

  if (brandMatch !== undefined) {
    return {
      reasonCode: 'COUNTERFEIT_HIGH_CONFIDENCE',
      severity: 'BLOCK',
      detail: `Product name contains protected brand "${brandMatch}" with no authorization evidence`,
    };
  }

  const signalMatch = matchesKeyword(
    evidence.name,
    COUNTERFEIT_SIGNAL_KEYWORDS,
  );

  if (signalMatch !== undefined) {
    return {
      reasonCode: 'COUNTERFEIT_HIGH_CONFIDENCE',
      severity: 'ATTENTION',
      detail: `Product name contains suspicious wording "${signalMatch}"`,
    };
  }

  return null;
}

export function checkPriceBoundsFull(
  evidence: CandidateEvidence,
): RuleFinding | null {
  if (evidence.supplierPriceUsd === null) {
    return {
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'ATTENTION',
      detail: 'Supplier price could not be read from CJ evidence',
    };
  }

  const cents = Math.round(evidence.supplierPriceUsd * 100);

  if (cents < MIN_PRICE_USD_CENTS || cents > MAX_PRICE_USD_CENTS) {
    return {
      reasonCode: 'INVALID_PRICE',
      severity: 'BLOCK',
      detail: `Supplier price ${evidence.supplierPriceUsd.toFixed(2)} USD is outside the configured valid range`,
    };
  }

  return null;
}

/**
 * Rough, NON-product-differentiated margin proxy - see
 * `policy.ts#estimatedMarginPercent`. Every candidate gets the same result
 * today; this is an attention signal only, never a real margin calculation.
 */
export function checkWeakMargin(): RuleFinding | null {
  const margin = estimatedMarginPercent();

  if (margin < MIN_MARGIN_PERCENT) {
    return {
      reasonCode: 'INVALID_PRICE',
      severity: 'ATTENTION',
      detail: `Estimated margin ${margin}% is below the placeholder floor ${MIN_MARGIN_PERCENT}%`,
    };
  }

  return null;
}

export function checkAbnormalPriceChange(
  currentPriceUsdCents: number | null,
  previousPriceUsdCents: number | null,
): RuleFinding | null {
  if (
    currentPriceUsdCents === null ||
    previousPriceUsdCents === null ||
    previousPriceUsdCents === 0
  ) {
    return null;
  }

  const changePercent =
    (Math.abs(currentPriceUsdCents - previousPriceUsdCents) /
      previousPriceUsdCents) *
    100;

  if (changePercent > ABNORMAL_PRICE_CHANGE_PERCENT) {
    return {
      reasonCode: 'ABNORMAL_PRICE_CHANGE',
      severity: 'ATTENTION',
      detail: `Supplier price moved ${changePercent.toFixed(0)}% since the last evaluation`,
    };
  }

  return null;
}

export function runQualification(
  evidence: CandidateEvidence,
  previousPriceUsdCents: number | null,
): RuleFinding[] {
  const currentPriceUsdCents =
    evidence.supplierPriceUsd === null
      ? null
      : Math.round(evidence.supplierPriceUsd * 100);

  return [
    checkImages(evidence),
    checkVariants(evidence),
    checkStock(evidence),
    checkShippingRoute(evidence),
    checkCounterfeitSignalFull(evidence),
    checkPriceBoundsFull(evidence),
    checkWeakMargin(),
    checkAbnormalPriceChange(currentPriceUsdCents, previousPriceUsdCents),
  ].filter((finding): finding is RuleFinding => finding !== null);
}

function countDuplicateImages(evidence: CandidateEvidence): number {
  // usableImageCount already de-duplicates by URL (see countUsableImages in
  // lib/cj/evidence.ts), so a duplicate count needs the raw variant image
  // list too - evidence only exposes the deduplicated count, so this counts
  // duplicate variant image references as the cheapest available signal.
  const variantImages = evidence.variants.map((variant) => variant.sku);

  return variantImages.length - new Set(variantImages).size;
}

export function summariseEvidence(
  evidence: CandidateEvidence,
  previousPriceUsdCents: number | null,
): EvidenceSummary {
  const totalStockUnits = totalVariantStock(evidence);
  const variantsWithStock = evidence.variants.filter(
    (variant) => (variant.totalInventory ?? 0) > 0,
  ).length;
  const warehousesWithStock = evidence.warehouses.filter(
    (warehouse) => (warehouse.totalInventory ?? 0) > 0,
  ).length;

  const notes: string[] = [];

  if (variantsWithStock > 0 && variantsWithStock < evidence.variants.length) {
    notes.push(
      `${evidence.variants.length - variantsWithStock} of ${evidence.variants.length} variants report no stock`,
    );
  }

  if (previousPriceUsdCents !== null) {
    notes.push('Price compared against the last recorded evaluation');
  }

  return {
    usableImageCount: evidence.usableImageCount,
    duplicateImageCount: countDuplicateImages(evidence),
    variantCount: evidence.variants.length,
    variantsWithStock,
    totalStockUnits,
    warehousesWithStock,
    sampledReviewCount: evidence.reviews.sampledCount,
    sampledAverageScore: evidence.reviews.sampledAverageScore,
    estimatedMarginPercent: estimatedMarginPercent(),
    screeningNotes: notes,
  };
}
