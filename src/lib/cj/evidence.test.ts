import { describe, expect, it } from 'vitest';
import toCandidateEvidence, { summariseReviews } from './evidence';
import type { CjProductDetail } from './enrichment-schemas';

/** Shaped after the live `/product/query` response captured 2026-08-07. */
const DETAIL: CjProductDetail = {
  pid: '2608061016491610100',
  productNameEn: 'Womens Floral Print Elastic-Waist Dress',
  productName: '2026 夏季连衣裙',
  productSku: 'CJLY3042134',
  productImage: 'https://cf.cjdropshipping.com/a.jpg',
  productImageSet: [
    'https://cf.cjdropshipping.com/a.jpg',
    'https://oss-cf.cjdropshipping.com/b.jpg',
    'https://evil.example.com/c.jpg',
  ],
  productWeight: '300.00-340.00',
  productType: 'ORDINARY_PRODUCT',
  categoryId: 'D2432903',
  categoryName: 'Lady Dresses',
  entryCode: '6104430000',
  description: '<p>supplier html</p>',
  sellPrice: '6.25',
  suggestSellPrice: '31.44',
  listedNum: 1,
  status: '3',
  createrTime: '2026-08-06T10:16:49+08:00',
  materialNameEnSet: ['Plastic'],
  packingNameEnSet: ['Plastic bags'],
  productKeyEnSet: ['Color', 'Size'],
  isTestProduct: false,
  variants: [
    {
      vid: 'vid-A',
      pid: '2608061016491610100',
      variantNameEn: 'Black 1XL',
      variantSku: 'SKU-A',
      variantImage: null,
      variantKey: 'Black-1XL',
      variantWeight: 320,
      variantLength: 300,
      variantWidth: 200,
      variantHeight: 30,
      variantVolume: 1_800_000,
      variantSellPrice: 6.25,
      inventoryNum: null,
    },
    {
      vid: 'vid-B',
      pid: '2608061016491610100',
      variantNameEn: 'Red 2XL',
      variantSku: 'SKU-B',
      variantImage: null,
      variantKey: 'Red-2XL',
      variantWeight: 330,
      variantLength: 300,
      variantWidth: 200,
      variantHeight: 30,
      variantVolume: 1_800_000,
      variantSellPrice: 6.5,
      inventoryNum: null,
    },
  ],
};

const CAPTURED_AT = new Date('2026-08-07T00:00:00.000Z');

describe('toCandidateEvidence', () => {
  it('joins inventory by vid, not by array position', () => {
    // CJ returns variantInventories in a different order from variants —
    // verified live. Index-joining here would attach B's stock to A.
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [
        {
          vid: 'vid-B',
          inventory: [
            {
              countryCode: 'CN',
              totalInventory: 99,
              cjInventory: 0,
              factoryInventory: 99,
              verifiedWarehouse: 'UNVERIFIED',
            },
          ],
        },
        {
          vid: 'vid-A',
          inventory: [
            {
              countryCode: 'CN',
              totalInventory: 7,
              cjInventory: 0,
              factoryInventory: 7,
              verifiedWarehouse: 'UNVERIFIED',
            },
          ],
        },
      ],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    const byVid = new Map(evidence.variants.map((v) => [v.vid, v]));
    expect(byVid.get('vid-A')?.totalInventory).toBe(7);
    expect(byVid.get('vid-B')?.totalInventory).toBe(99);
    expect(byVid.get('vid-A')?.stockByOrigin).toEqual([
      {
        countryCode: 'CN',
        totalInventory: 7,
        cjInventory: 0,
        factoryInventory: 7,
        verifiedWarehouse: 'UNVERIFIED',
      },
    ]);
  });

  it('reads per-variant stock from totalInventory, not the warehouse totalInventoryNum', () => {
    // Regression: the two CJ levels use different field names. Sharing one
    // schema made every variant report null while real stock existed.
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [
        {
          vid: 'vid-A',
          inventory: [
            {
              countryCode: 'CN',
              totalInventory: 6406,
              cjInventory: 0,
              factoryInventory: 6406,
              verifiedWarehouse: 'UNVERIFIED',
            },
          ],
        },
      ],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.variants[0].totalInventory).toBe(6406);
  });

  it('reports null stock for a variant CJ did not report, not zero', () => {
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.variants[0].totalInventory).toBeNull();
    expect(evidence.variants[0].stockByOrigin).toEqual([]);
    expect(evidence.variants[0].stockEvidence).toBe('UNKNOWN_STOCK');
  });

  it('sums a variant stock across warehouses', () => {
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [
        {
          vid: 'vid-A',
          inventory: [
            {
              countryCode: 'CN',
              totalInventory: 5,
              cjInventory: 5,
              factoryInventory: 0,
              verifiedWarehouse: 'VERIFIED',
            },
            {
              countryCode: 'US',
              totalInventory: 3,
              cjInventory: 0,
              factoryInventory: 3,
              verifiedWarehouse: 'UNKNOWN',
            },
          ],
        },
      ],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.variants[0].totalInventory).toBe(8);
  });

  it("preserves each origin's verified/unverified/unknown warehouse state exactly as parsed, per vid", () => {
    // The raw-number-to-state mapping (1/2/absent) is the schema boundary's
    // job, covered in enrichment-schemas.test.ts. This checks that
    // toCandidateEvidence, given already-parsed states, never collapses or
    // reassigns them across origins.
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [
        {
          vid: 'vid-A',
          inventory: [
            {
              countryCode: 'CN',
              totalInventory: 5,
              cjInventory: 5,
              factoryInventory: 0,
              verifiedWarehouse: 'VERIFIED',
            },
            {
              countryCode: 'US',
              totalInventory: 3,
              cjInventory: 0,
              factoryInventory: 3,
              verifiedWarehouse: 'UNVERIFIED',
            },
            {
              countryCode: 'AU',
              totalInventory: 1,
              cjInventory: 1,
              factoryInventory: 0,
              verifiedWarehouse: 'UNKNOWN',
            },
          ],
        },
      ],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    const [cn, us, au] = evidence.variants[0].stockByOrigin;
    expect(cn.verifiedWarehouse).toBe('VERIFIED');
    expect(us.verifiedWarehouse).toBe('UNVERIFIED');
    expect(au.verifiedWarehouse).toBe('UNKNOWN');
  });

  it('derives mixed stock evidence when one origin is CJ-backed and another factory-backed, and it survives a JSON round-trip', () => {
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [
        {
          vid: 'vid-A',
          inventory: [
            {
              countryCode: 'CN',
              totalInventory: 5,
              cjInventory: 5,
              factoryInventory: 0,
              verifiedWarehouse: 'VERIFIED',
            },
            {
              countryCode: 'US',
              totalInventory: 3,
              cjInventory: 0,
              factoryInventory: 3,
              verifiedWarehouse: 'UNVERIFIED',
            },
          ],
        },
      ],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.variants[0].stockEvidence).toBe('MIXED_STOCK');

    // Raw components must survive snapshot serialization (JSON in Postgres jsonb).
    const roundTripped: typeof evidence = JSON.parse(JSON.stringify(evidence));
    expect(roundTripped.variants[0].stockByOrigin).toEqual(
      evidence.variants[0].stockByOrigin,
    );
  });

  it('counts only allow-listed image hosts as usable', () => {
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    // Two CJ hosts plus the duplicate cover image; the evil.example.com entry
    // must not be counted.
    expect(evidence.usableImageCount).toBe(2);
  });

  it('prefers the English name and keeps the supplier price as a number', () => {
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.name).toBe('Womens Floral Print Elastic-Waist Dress');
    expect(evidence.supplierPriceUsd).toBe(6.25);
  });

  it("threads each variant's own length/width/height/volume through unchanged", () => {
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.variants[0]).toMatchObject({
      lengthMm: 300,
      widthMm: 200,
      heightMm: 30,
      volumeMm3: 1_800_000,
    });
  });

  it('reports one packed-dimensions reading when every variant shares the same box size', () => {
    // Both DETAIL variants are 300x200x30mm — CJ has no single product-level
    // dimension field the way it does for weight, so this is derived from
    // the variants, deduplicated to one reading when they agree.
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.packedDimensionsLabel).toBe('30×20×3 cm');
  });

  it('reports every distinct box size CJ actually recorded, never one picked as representative', () => {
    const detail: CjProductDetail = {
      ...DETAIL,
      variants: [
        DETAIL.variants[0],
        {
          ...DETAIL.variants[1],
          variantLength: 400,
          variantWidth: 250,
          variantHeight: 50,
        },
      ],
    };

    const evidence = toCandidateEvidence({
      detail,
      warehouseInventories: [],
      variantInventories: [],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.packedDimensionsLabel).toBe('30×20×3 cm, 40×25×5 cm');
  });

  it('reports no packed dimensions when no variant has a complete length/width/height, rather than guessing', () => {
    const detail: CjProductDetail = {
      ...DETAIL,
      variants: DETAIL.variants.map((variant) => ({
        ...variant,
        variantLength: null,
      })),
    };

    const evidence = toCandidateEvidence({
      detail,
      warehouseInventories: [],
      variantInventories: [],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.packedDimensionsLabel).toBeNull();
  });

  it('carries CJ status through without judging whether it means on-sale', () => {
    const evidence = toCandidateEvidence({
      detail: DETAIL,
      warehouseInventories: [],
      variantInventories: [],
      reviewTotal: 0,
      comments: [],
      capturedAt: CAPTURED_AT,
    });

    expect(evidence.sourceStatusRaw).toBe('3');
    expect(evidence).not.toHaveProperty('isOnSale');
    expect(evidence).not.toHaveProperty('decision');
    expect(evidence).not.toHaveProperty('qualityScore');
  });
});

describe('summariseReviews', () => {
  it('reports zero without inventing a rating when CJ has no reviews', () => {
    expect(summariseReviews(0, [])).toEqual({
      totalCount: 0,
      sampledCount: 0,
      sampledAverageScore: null,
    });
  });

  it('averages only the sampled page and keeps the real total separate', () => {
    const result = summariseReviews(250, [
      { comment: 'a', commentDate: '2026-01-01', score: 5, countryCode: 'US' },
      { comment: 'b', commentDate: '2026-01-02', score: 3, countryCode: 'PH' },
    ]);

    expect(result.totalCount).toBe(250);
    expect(result.sampledCount).toBe(2);
    expect(result.sampledAverageScore).toBe(4);
  });

  it('ignores comments with an unusable score', () => {
    const result = summariseReviews(2, [
      { comment: 'a', commentDate: '', score: null, countryCode: '' },
      { comment: 'b', commentDate: '', score: 4, countryCode: '' },
    ]);

    expect(result.sampledAverageScore).toBe(4);
  });
});
