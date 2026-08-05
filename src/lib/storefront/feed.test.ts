import { describe, expect, it, vi } from 'vitest';
import type { CjProduct } from '@/lib/cj/normalize';
import {
  listStorefrontCategories,
  storefrontFeedQuerySchema,
  toStorefrontProduct,
  toStorefrontProductFeed,
} from './feed';

function cjProduct(overrides: Partial<CjProduct> = {}): CjProduct {
  return {
    id: 'CJYD3038814',
    name: 'Insole For Flat-foot Correction Pure Blue',
    sku: 'CJYD3038814',
    imageUrl: 'https://cf.cjdropshipping.com/image.webp',
    category: "Men's Insoles",
    priceCentsUsd: 72,
    weight: '60.00-85.00 g',
    productType: 'ordinary',
    supplier: 'CJ',
    freeShipping: false,
    shipsFrom: ['CN', 'CN_US'],
    listedCount: 4,
    createdAt: '2026-08-05',
    ...overrides,
  };
}

describe('CJ storefront feed', () => {
  it('maps a CJ product into the ecommerce card shape with PHP pricing', () => {
    vi.stubEnv('CJ_USD_TO_PHP_RATE', '58');
    vi.stubEnv('CJ_PRICE_MARKUP_PERCENT', '30');

    expect(toStorefrontProduct(cjProduct(), 'for-you')).toMatchObject({
      id: 'CJYD3038814',
      slug: 'cjyd3038814',
      title: 'Insole For Flat-foot Correction Pure Blue',
      priceMinor: 5429,
      oldPriceMinor: 5429,
      imageUrl: 'https://cf.cjdropshipping.com/image.webp',
      ratingLine: 'Supplier item',
      shipLine: 'Ships from CN, CN_US',
      category: 'men-s-insoles',
    });

    vi.unstubAllEnvs();
  });

  it('skips CJ products without a usable supplier price', () => {
    expect(
      toStorefrontProduct(cjProduct({ priceCentsUsd: null }), 'for-you'),
    ).toBeNull();
  });

  it('adds a compare price for deals', () => {
    const product = toStorefrontProduct(cjProduct(), 'deals');

    expect(product?.oldPriceMinor).toBeGreaterThan(product?.priceMinor ?? 0);
  });

  it('sorts deals by listed count when available', () => {
    const feed = toStorefrontProductFeed(
      [
        cjProduct({ id: 'low', listedCount: 1 }),
        cjProduct({ id: 'high', listedCount: 9 }),
      ],
      { section: 'deals', page: 1, limit: 2 },
      2,
    );

    expect(feed.products.map((product) => product.id)).toEqual(['high', 'low']);
  });

  it('clamps bad query input', () => {
    const query = storefrontFeedQuerySchema.parse({
      section: 'bad',
      page: '2',
      limit: '14',
    });

    expect(query).toEqual({ section: 'for-you', page: 2, limit: 14 });
  });

  it('lists categories from CJ products', () => {
    expect(listStorefrontCategories([cjProduct()])).toEqual([
      { id: 'men-s-insoles', code: 'MI', name: "Men's Insoles" },
    ]);
  });
});
