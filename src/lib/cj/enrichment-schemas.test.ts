import { describe, expect, it } from 'vitest';
import {
  cjInventoryResponseSchema,
  cjProductDetailResponseSchema,
  cjVariantStockSchema,
  cjWarehouseInventorySchema,
} from './enrichment-schemas';

/**
 * These fixtures are copied from real CJ responses captured on 2026-08-07,
 * field names and all. They exist to catch the class of bug that already bit
 * once here: the product-level and per-variant inventory objects describe the
 * same idea with different key names, and treating them as one shape parses
 * real stock as null.
 */

const REAL_WAREHOUSE_ENTRY = {
  areaEn: 'China Warehouse',
  areaId: 1,
  countryCode: 'CN',
  totalInventoryNum: 36338,
  cjInventoryNum: 0,
  factoryInventoryNum: 36338,
  countryNameEn: 'China Warehouse',
  stock: null,
};

const REAL_VARIANT_STOCK_ENTRY = {
  countryCode: 'CN',
  totalInventory: 6406,
  cjInventory: 0,
  factoryInventory: 6406,
  verifiedWarehouse: 2,
  stock: [
    {
      stockId: '{6709CCD7-0DC7-43B1-B310-17AB499E9B0A}',
      inventory: 0,
      factoryInventory: 6406,
    },
  ],
};

describe('inventory field names differ by level', () => {
  it('parses a real product-level warehouse entry', () => {
    const parsed = cjWarehouseInventorySchema.parse(REAL_WAREHOUSE_ENTRY);

    expect(parsed.totalInventoryNum).toBe(36338);
    expect(parsed.countryNameEn).toBe('China Warehouse');
  });

  it('parses a real per-variant stock entry', () => {
    const parsed = cjVariantStockSchema.parse(REAL_VARIANT_STOCK_ENTRY);

    expect(parsed.totalInventory).toBe(6406);
    expect(parsed.factoryInventory).toBe(6406);
  });

  it('does not find a per-variant total under the warehouse field name', () => {
    // The guard: if someone reuses the warehouse schema for variant stock,
    // this is what happens — a real 6406 becomes null.
    const wrong = cjWarehouseInventorySchema.parse(REAL_VARIANT_STOCK_ENTRY);

    expect(wrong.totalInventoryNum).toBeNull();
  });
});

describe('cjInventoryResponseSchema', () => {
  it('parses a real getInventoryByPid response, keeping both levels intact', () => {
    const parsed = cjInventoryResponseSchema.parse({
      code: 200,
      message: '',
      pointsInfo: { total: 56107, usedToday: 50130, remaining: 51539 },
      data: {
        inventories: [REAL_WAREHOUSE_ENTRY],
        variantInventories: [
          { vid: '2608061016491611900', inventory: [REAL_VARIANT_STOCK_ENTRY] },
        ],
      },
    });

    expect(parsed.data?.inventories[0].totalInventoryNum).toBe(36338);
    expect(parsed.data?.variantInventories[0].inventory[0].totalInventory).toBe(
      6406,
    );
    expect(parsed.pointsInfo?.remaining).toBe(51539);
  });

  it('treats a null data block as no inventory rather than failing', () => {
    const parsed = cjInventoryResponseSchema.parse({
      code: 200,
      message: '',
      data: null,
    });

    expect(parsed.data).toBeNull();
  });
});

describe('cjProductDetailResponseSchema', () => {
  it('keeps the variants embedded in the detail response', () => {
    const parsed = cjProductDetailResponseSchema.parse({
      code: 200,
      message: 'Success',
      pointsInfo: { total: 1, usedToday: 1, remaining: 1 },
      data: {
        pid: 'p1',
        productNameEn: 'A dress',
        productName: '连衣裙',
        productSku: 'CJ1',
        productImage: 'https://cf.cjdropshipping.com/a.jpg',
        productImageSet: ['https://cf.cjdropshipping.com/a.jpg'],
        productWeight: '300.00-340.00',
        productType: 'ORDINARY_PRODUCT',
        categoryId: 'c1',
        categoryName: 'Lady Dresses',
        entryCode: '6104430000',
        description: '<p>html</p>',
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
            vid: 'v1',
            pid: 'p1',
            variantNameEn: 'Black 1XL',
            variantSku: 'CJ1-A',
            variantImage: 'https://cf.cjdropshipping.com/v.jpg',
            variantKey: 'Black-1XL',
            variantWeight: 320,
            variantLength: 300,
            variantWidth: 200,
            variantHeight: 30,
            variantSellPrice: 6.25,
            inventoryNum: null,
          },
        ],
      },
    });

    expect(parsed.data?.variants).toHaveLength(1);
    expect(parsed.data?.variants[0].variantKey).toBe('Black-1XL');
  });

  it('drops an image from a host we never allow-listed', () => {
    const parsed = cjProductDetailResponseSchema.parse({
      code: 200,
      message: 'Success',
      data: {
        pid: 'p1',
        productImage: 'https://evil.example.com/a.jpg',
        variants: [],
      },
    });

    expect(parsed.data?.productImage).toBeNull();
  });
});
