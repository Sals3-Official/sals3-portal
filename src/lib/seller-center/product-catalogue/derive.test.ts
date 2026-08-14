import { describe, expect, it } from 'vitest';
import {
  deriveProductAvailability,
  estimateMarginMinor,
  isCheckoutAllowed,
  worstAttentionSeverity,
  worstEvidenceFreshness,
} from './derive';
import type {
  AttentionReasonFixture,
  CatalogueProductFixture,
  CatalogueVariantFixture,
} from './types';

function money(amountMinor: number, currency = 'USD') {
  return { amountMinor, currency };
}

function variant(
  overrides: Partial<CatalogueVariantFixture> & { id: string },
): CatalogueVariantFixture {
  return {
    optionLabel: 'Size: M',
    supplierOptionLabel: null,
    sals3VariantId: `SALS3-V-${overrides.id}`,
    sellerSku: `SKU-${overrides.id}`,
    cjVariantId: `CJVID-${overrides.id}`,
    hasImage: true,
    sellingPrice: money(1000),
    supplierCost: money(400),
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 10,
    lastCheckedAt: '2026-08-10T00:00:00.000Z',
    evidenceFreshness: 'FRESH',
    manuallyPaused: false,
    ...overrides,
  };
}

function attentionReason(
  overrides: Partial<AttentionReasonFixture> & { id: string },
): AttentionReasonFixture {
  return {
    severity: 'MEDIUM',
    reasonCode: 'TEST_REASON',
    summary: 'Test reason',
    checkoutAllowed: true,
    ...overrides,
  };
}

function product(
  overrides: Partial<CatalogueProductFixture> & { id: string },
): CatalogueProductFixture {
  return {
    sals3ProductId: `SALS3-P-${overrides.id}`,
    name: 'Untitled product',
    hasImage: true,
    status: 'LIVE',
    categoryPath: 'Category A',
    createdAt: '2026-08-01T00:00:00.000Z',
    supplierProviderCode: 'cj-dropshipping',
    supplierProviderName: 'CJ Dropshipping',
    supplierConnectionHealth: 'CONNECTED',
    cjProductId: `ext-${overrides.id}`,
    sellingPrice: money(1000),
    availability: 'AVAILABLE',
    stockEvidence: 'CJ_WAREHOUSE_STOCK',
    supplierObservedQuantity: 10,
    lastCheckedAt: '2026-08-10T00:00:00.000Z',
    evidenceFreshness: 'FRESH',
    mediaStatus: 'OWN_PICTURES',
    contentReadiness: 'GOOD',
    pauseReason: null,
    storefrontUrl: null,
    attentionReasons: [],
    editorFixtureKey: 'pass',
    variants: [],
    ...overrides,
  };
}

describe('deriveProductAvailability', () => {
  it('falls back to the product field when there are no variants', () => {
    expect(deriveProductAvailability([], 'MARKET_UNAVAILABLE')).toBe(
      'MARKET_UNAVAILABLE',
    );
  });

  it('is AVAILABLE when every variant is available', () => {
    const variants = [
      variant({ id: 'a', availability: 'AVAILABLE' }),
      variant({ id: 'b', availability: 'AVAILABLE' }),
    ];

    expect(deriveProductAvailability(variants, 'AVAILABLE')).toBe('AVAILABLE');
  });

  it('one unavailable variant among purchasable siblings never reports the whole product out of stock', () => {
    const variants = [
      variant({ id: 'a', availability: 'AVAILABLE' }),
      variant({ id: 'b', availability: 'OUT_OF_STOCK' }),
    ];

    expect(deriveProductAvailability(variants, 'AVAILABLE')).toBe(
      'SOME_VARIANTS_UNAVAILABLE',
    );
  });

  it('every variant unavailable reports the product fully unavailable, never AVAILABLE by omission', () => {
    const variants = [
      variant({ id: 'a', availability: 'OUT_OF_STOCK' }),
      variant({ id: 'b', availability: 'OUT_OF_STOCK' }),
    ];

    expect(deriveProductAvailability(variants, 'AVAILABLE')).toBe(
      'OUT_OF_STOCK',
    );
  });

  it('every variant supplier-disconnected reports SUPPLIER_DISCONNECTED', () => {
    const variants = [
      variant({ id: 'a', availability: 'SUPPLIER_DISCONNECTED' }),
      variant({ id: 'b', availability: 'SUPPLIER_DISCONNECTED' }),
    ];

    expect(deriveProductAvailability(variants, 'AVAILABLE')).toBe(
      'SUPPLIER_DISCONNECTED',
    );
  });
});

describe('worstAttentionSeverity', () => {
  it('returns null when there is no open attention', () => {
    expect(worstAttentionSeverity([])).toBeNull();
  });

  it('returns the worst severity present, not the first or last', () => {
    const reasons = [
      attentionReason({ id: 'a', severity: 'LOW' }),
      attentionReason({ id: 'b', severity: 'CRITICAL' }),
      attentionReason({ id: 'c', severity: 'MEDIUM' }),
    ];

    expect(worstAttentionSeverity(reasons)).toBe('CRITICAL');
  });
});

describe('isCheckoutAllowed', () => {
  it('is false for DRAFT, AUTO_PAUSED, and ARCHIVED listings', () => {
    expect(isCheckoutAllowed(product({ id: 'a', status: 'DRAFT' }))).toBe(
      false,
    );
    expect(isCheckoutAllowed(product({ id: 'b', status: 'AUTO_PAUSED' }))).toBe(
      false,
    );
    expect(isCheckoutAllowed(product({ id: 'c', status: 'ARCHIVED' }))).toBe(
      false,
    );
  });

  it('is true for a LIVE listing with no blocking attention', () => {
    expect(isCheckoutAllowed(product({ id: 'a', status: 'LIVE' }))).toBe(true);
  });

  it('is false when any open attention reason blocks checkout, even while LIVE', () => {
    const flagged = product({
      id: 'a',
      status: 'LIVE_NEEDS_ATTENTION',
      attentionReasons: [attentionReason({ id: 'r1', checkoutAllowed: false })],
    });

    expect(isCheckoutAllowed(flagged)).toBe(false);
  });
});

describe('worstEvidenceFreshness', () => {
  it('falls back to the product field when there are no variants', () => {
    expect(worstEvidenceFreshness([], 'STALE')).toBe('STALE');
  });

  it('is UNKNOWN when any variant is UNKNOWN, even if others are FRESH', () => {
    const variants = [
      variant({ id: 'a', evidenceFreshness: 'FRESH' }),
      variant({ id: 'b', evidenceFreshness: 'UNKNOWN' }),
    ];

    expect(worstEvidenceFreshness(variants, 'FRESH')).toBe('UNKNOWN');
  });
});

describe('estimateMarginMinor', () => {
  it('subtracts supplier cost from selling price in the same currency', () => {
    expect(estimateMarginMinor(money(1000), money(400))).toBe(600);
  });

  it('returns null for mismatched currencies rather than silently subtracting', () => {
    expect(
      estimateMarginMinor(money(1000, 'USD'), money(400, 'EUR')),
    ).toBeNull();
  });
});
