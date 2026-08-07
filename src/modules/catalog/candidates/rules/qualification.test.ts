import { describe, expect, it } from 'vitest';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import {
  checkAbnormalPriceChange,
  checkImages,
  checkShippingRoute,
  checkStock,
  checkVariants,
  runQualification,
  summariseEvidence,
} from './qualification';

function evidence(overrides: Partial<CandidateEvidence>): CandidateEvidence {
  return {
    externalProductId: 'CJLY1',
    name: 'Plain phone case',
    supplierSku: 'SKU-1',
    categoryName: 'Phone accessories',
    entryCode: '3926909090',
    supplierPriceUsd: 5,
    packedWeight: '100',
    sourceStatusRaw: '3',
    isTestProduct: false,
    listedCount: 10,
    usableImageCount: 3,
    variants: [
      {
        vid: 'v1',
        sku: 'v1-sku',
        optionLabel: 'Black',
        priceUsd: 5,
        weightGrams: 100,
        totalInventory: 10,
      },
      {
        vid: 'v2',
        sku: 'v2-sku',
        optionLabel: 'White',
        priceUsd: 5,
        weightGrams: 100,
        totalInventory: 5,
      },
    ],
    warehouses: [
      { countryCode: 'CN', name: 'China warehouse', totalInventory: 15 },
    ],
    reviews: { totalCount: 20, sampledCount: 5, sampledAverageScore: 4.2 },
    capturedAt: new Date('2026-08-07T00:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('checkImages', () => {
  it('blocks zero usable images', () => {
    expect(checkImages(evidence({ usableImageCount: 0 }))).toMatchObject({
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'BLOCK',
    });
  });

  it('flags one or two images as attention, not a block', () => {
    expect(checkImages(evidence({ usableImageCount: 2 }))).toMatchObject({
      severity: 'ATTENTION',
    });
  });

  it('passes three or more usable images', () => {
    expect(checkImages(evidence({ usableImageCount: 3 }))).toBeNull();
  });
});

describe('checkVariants', () => {
  it('blocks zero variants', () => {
    expect(checkVariants(evidence({ variants: [] }))).toMatchObject({
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'BLOCK',
    });
  });

  it('flags duplicate option labels as attention', () => {
    const withDuplicate = evidence({
      variants: [
        {
          vid: 'v1',
          sku: 's1',
          optionLabel: 'Black',
          priceUsd: 5,
          weightGrams: 100,
          totalInventory: 10,
        },
        {
          vid: 'v2',
          sku: 's2',
          optionLabel: 'Black',
          priceUsd: 5,
          weightGrams: 100,
          totalInventory: 5,
        },
      ],
    });

    expect(checkVariants(withDuplicate)).toMatchObject({
      severity: 'ATTENTION',
    });
  });
});

describe('checkStock', () => {
  it('blocks when every variant reports zero or unknown stock', () => {
    const noStock = evidence({
      variants: [
        {
          vid: 'v1',
          sku: 's1',
          optionLabel: 'Black',
          priceUsd: 5,
          weightGrams: 100,
          totalInventory: 0,
        },
      ],
    });

    expect(checkStock(noStock)).toMatchObject({
      reasonCode: 'NO_STOCK',
      severity: 'BLOCK',
    });
  });

  it('does not block partial stock - that is informational only', () => {
    expect(checkStock(evidence({}))).toBeNull();
  });
});

describe('checkShippingRoute', () => {
  it('blocks when no warehouse reports any stock', () => {
    const noRoute = evidence({
      warehouses: [{ countryCode: 'CN', name: 'China', totalInventory: 0 }],
    });

    expect(checkShippingRoute(noRoute)).toMatchObject({
      reasonCode: 'NO_SHIPPING_ROUTE',
      severity: 'BLOCK',
    });
  });

  it('passes when at least one warehouse has stock', () => {
    expect(checkShippingRoute(evidence({}))).toBeNull();
  });
});

describe('checkAbnormalPriceChange', () => {
  it('flags a sharp price increase since the last evaluation', () => {
    const result = checkAbnormalPriceChange(1000, 500);

    expect(result).toMatchObject({
      reasonCode: 'ABNORMAL_PRICE_CHANGE',
      severity: 'ATTENTION',
    });
  });

  it('is silent on the first evaluation (no previous price)', () => {
    expect(checkAbnormalPriceChange(1000, null)).toBeNull();
  });

  it('is silent on a small price change', () => {
    expect(checkAbnormalPriceChange(510, 500)).toBeNull();
  });
});

describe('runQualification', () => {
  it('produces no findings for clean evidence', () => {
    expect(runQualification(evidence({}), null)).toEqual([]);
  });

  it('never claims a fact CJ did not return - no dimension/attribute checks exist', () => {
    // Regression guard: this suite intentionally has no test asserting an
    // image-dimension or category-required-attribute check, because CJ's
    // modelled endpoints do not return either. See the plan's rule-mapping
    // table (#6, #8).
    expect(runQualification(evidence({}), null)).not.toContainEqual(
      expect.objectContaining({
        reasonCode: expect.stringContaining('DIMENSION'),
      }),
    );
  });
});

describe('summariseEvidence', () => {
  it('reports partial-stock as an informational note, not a reason code', () => {
    const summary = summariseEvidence(evidence({}), null);

    expect(summary.variantsWithStock).toBe(2);
    expect(summary.totalStockUnits).toBe(15);
    expect(summary.screeningNotes).toEqual([]);
  });

  it('notes when some variants have no stock', () => {
    const partial = evidence({
      variants: [
        {
          vid: 'v1',
          sku: 's1',
          optionLabel: 'Black',
          priceUsd: 5,
          weightGrams: 100,
          totalInventory: 10,
        },
        {
          vid: 'v2',
          sku: 's2',
          optionLabel: 'White',
          priceUsd: 5,
          weightGrams: 100,
          totalInventory: 0,
        },
      ],
    });
    const summary = summariseEvidence(partial, null);

    expect(summary.screeningNotes).toEqual(['1 of 2 variants report no stock']);
  });
});
