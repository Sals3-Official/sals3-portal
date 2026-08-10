import { describe, expect, it } from 'vitest';
import type { CandidateEvidence, VariantEvidence } from '@/lib/cj/evidence';
import {
  checkAbnormalPriceChange,
  checkImages,
  checkStockedOrigin,
  checkStock,
  checkVariants,
  runQualification,
  summariseEvidence,
} from './qualification';

/** Fills in `stockByOrigin`/`stockEvidence` from a plain total for test brevity. */
function variant(overrides: Partial<VariantEvidence>): VariantEvidence {
  const totalInventory = overrides.totalInventory ?? 10;

  return {
    vid: 'v1',
    sku: 'v1-sku',
    optionLabel: 'Black',
    priceUsd: 5,
    weightGrams: 100,
    stockByOrigin:
      totalInventory === null
        ? []
        : [
            {
              countryCode: 'CN',
              totalInventory,
              cjInventory: totalInventory,
              factoryInventory: 0,
              verifiedWarehouse: 'UNKNOWN',
            },
          ],
    totalInventory,
    stockEvidence:
      totalInventory === null || totalInventory <= 0
        ? 'ZERO_STOCK'
        : 'CJ_WAREHOUSE_STOCK',
    ...overrides,
  };
}

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
      variant({
        vid: 'v1',
        sku: 'v1-sku',
        optionLabel: 'Black',
        totalInventory: 10,
      }),
      variant({
        vid: 'v2',
        sku: 'v2-sku',
        optionLabel: 'White',
        totalInventory: 5,
      }),
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
        variant({
          vid: 'v1',
          sku: 's1',
          optionLabel: 'Black',
          totalInventory: 10,
        }),
        variant({
          vid: 'v2',
          sku: 's2',
          optionLabel: 'Black',
          totalInventory: 5,
        }),
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
        variant({
          vid: 'v1',
          sku: 's1',
          optionLabel: 'Black',
          totalInventory: 0,
        }),
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

describe('checkStockedOrigin', () => {
  it('blocks with NO_STOCKED_ORIGIN when no origin reports any stock, without mentioning freight/route', () => {
    const noStockedOrigin = evidence({
      warehouses: [{ countryCode: 'CN', name: 'China', totalInventory: 0 }],
    });

    const finding = checkStockedOrigin(noStockedOrigin);

    expect(finding).toMatchObject({
      reasonCode: 'NO_STOCKED_ORIGIN',
      severity: 'BLOCK',
    });
    expect(finding?.detail?.toLowerCase()).not.toContain('shipping');
    expect(finding?.detail?.toLowerCase()).not.toContain('route');
    expect(finding?.detail?.toLowerCase()).not.toContain('freight');
  });

  it('passes when at least one origin has stock', () => {
    expect(checkStockedOrigin(evidence({}))).toBeNull();
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

  it('treats factory-backed, unverified stock the same as CJ-warehouse stock — neither an automatic pass nor a permanent block', () => {
    // ADR-013: stock evidence is evidence, not policy. checkStock/
    // checkStockedOrigin must not treat FACTORY_BACKED_STOCK/UNVERIFIED any
    // differently from CJ_WAREHOUSE_STOCK/VERIFIED while no versioned policy
    // decision exists yet.
    const buildWith = (
      stockEvidence: VariantEvidence['stockEvidence'],
      stock: {
        cjInventory: number;
        factoryInventory: number;
        verifiedWarehouse: VariantEvidence['stockByOrigin'][number]['verifiedWarehouse'];
      },
    ) =>
      evidence({
        variants: [
          {
            vid: 'v1',
            sku: 'v1-sku',
            optionLabel: 'Black',
            priceUsd: 5,
            weightGrams: 100,
            stockByOrigin: [
              {
                countryCode: 'CN',
                totalInventory: 10,
                cjInventory: stock.cjInventory,
                factoryInventory: stock.factoryInventory,
                verifiedWarehouse: stock.verifiedWarehouse,
              },
            ],
            totalInventory: 10,
            stockEvidence,
          },
        ],
        warehouses: [
          { countryCode: 'CN', name: 'China warehouse', totalInventory: 10 },
        ],
      });

    const cjBacked = buildWith('CJ_WAREHOUSE_STOCK', {
      cjInventory: 10,
      factoryInventory: 0,
      verifiedWarehouse: 'VERIFIED',
    });
    const factoryBacked = buildWith('FACTORY_BACKED_STOCK', {
      cjInventory: 0,
      factoryInventory: 10,
      verifiedWarehouse: 'UNVERIFIED',
    });

    expect(runQualification(factoryBacked, null)).toEqual(
      runQualification(cjBacked, null),
    );
    expect(checkStock(factoryBacked)).toBeNull();
    expect(checkStockedOrigin(factoryBacked)).toBeNull();
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
        variant({
          vid: 'v1',
          sku: 's1',
          optionLabel: 'Black',
          totalInventory: 10,
        }),
        variant({
          vid: 'v2',
          sku: 's2',
          optionLabel: 'White',
          totalInventory: 0,
        }),
      ],
    });
    const summary = summariseEvidence(partial, null);

    expect(summary.screeningNotes).toEqual(['1 of 2 variants report no stock']);
  });
});
