import type { MoneyValue } from '@/lib/seller-center/product-editor/types';
import type {
  Availability,
  AttentionReasonFixture,
  AttentionSeverity,
  CatalogueProductFixture,
  CatalogueVariantFixture,
  EvidenceFreshness,
} from './types';

/**
 * Pure derivation logic, kept out of components so the "smallest affected
 * scope" rules in ADR-007/ADR-013 are unit-tested directly rather than only
 * through rendered DOM assertions - the same split `product-editor/derive.ts`
 * uses.
 */

const AVAILABILITY_PRIORITY: Availability[] = [
  'SUPPLIER_DISCONNECTED',
  'MARKET_UNAVAILABLE',
  'OUT_OF_STOCK',
  'UNKNOWN_OR_STALE',
  'SUPPLIER_CHECK_PENDING',
  'SOME_VARIANTS_UNAVAILABLE',
  'AVAILABLE',
];

function worstAvailability(states: Availability[]): Availability {
  return (
    AVAILABILITY_PRIORITY.find((candidate) => states.includes(candidate)) ??
    'AVAILABLE'
  );
}

/**
 * A product's own availability is derived from its variants, never stored
 * independently of them, so one unavailable variant can never be reported
 * as the whole product being out of stock while a sibling variant is still
 * purchasable - and a product where every variant is unavailable always
 * reads as fully unavailable, never as "available" by omission.
 *
 * A product with no variants (a single-offer listing) has no variant list
 * to derive from, so its own `fallbackAvailability` is authoritative.
 */
export function deriveProductAvailability(
  variants: CatalogueVariantFixture[],
  fallbackAvailability: Availability,
): Availability {
  if (variants.length === 0) return fallbackAvailability;

  const nonDisconnected = variants.filter(
    (variant) => variant.availability !== 'SUPPLIER_DISCONNECTED',
  );

  if (nonDisconnected.length === 0) return 'SUPPLIER_DISCONNECTED';

  const unavailable = new Set<Availability>([
    'OUT_OF_STOCK',
    'MARKET_UNAVAILABLE',
    'SUPPLIER_DISCONNECTED',
    'UNKNOWN_OR_STALE',
  ]);

  const allUnavailable = variants.every((variant) =>
    unavailable.has(variant.availability),
  );

  if (allUnavailable) {
    return worstAvailability(variants.map((variant) => variant.availability));
  }

  const anyUnavailable = variants.some(
    (variant) =>
      unavailable.has(variant.availability) ||
      variant.availability === 'SUPPLIER_CHECK_PENDING',
  );

  if (anyUnavailable) return 'SOME_VARIANTS_UNAVAILABLE';

  return 'AVAILABLE';
}

const ATTENTION_SEVERITY_ORDER: AttentionSeverity[] = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
];

/** `null` when there is no open attention - never a fabricated "OK" severity. */
export function worstAttentionSeverity(
  reasons: AttentionReasonFixture[],
): AttentionSeverity | null {
  return (
    ATTENTION_SEVERITY_ORDER.find((severity) =>
      reasons.some((reason) => reason.severity === severity),
    ) ?? null
  );
}

/** Whether every current publication/checkout gate for this product allows a new sale right now. */
export function isCheckoutAllowed(product: CatalogueProductFixture): boolean {
  if (product.status !== 'LIVE' && product.status !== 'LIVE_NEEDS_ATTENTION') {
    return false;
  }

  return product.attentionReasons.every((reason) => reason.checkoutAllowed);
}

const FRESHNESS_PRIORITY: EvidenceFreshness[] = ['UNKNOWN', 'STALE', 'FRESH'];

/** Product-level evidence freshness is the least-fresh state among its variants. */
export function worstEvidenceFreshness(
  variants: CatalogueVariantFixture[],
  fallback: EvidenceFreshness,
): EvidenceFreshness {
  if (variants.length === 0) return fallback;

  const states = variants.map((variant) => variant.evidenceFreshness);

  return (
    FRESHNESS_PRIORITY.find((candidate) => states.includes(candidate)) ??
    'FRESH'
  );
}

/**
 * Illustrative only - excludes freight, payment fees, returns, and duties,
 * same caveat the approved pricing spec already states for the real
 * pricing module. `null` when the two values are not the same currency,
 * never a silently wrong cross-currency subtraction.
 */
export function estimateMarginMinor(
  sellingPrice: MoneyValue,
  supplierCost: MoneyValue,
): number | null {
  if (sellingPrice.currency !== supplierCost.currency) return null;

  return sellingPrice.amountMinor - supplierCost.amountMinor;
}
