import { describe, expect, it } from 'vitest';
import type { CatalogueFilters } from '@/components/products/catalogue/CatalogueFilterBar';
import {
  countByStatus,
  countOutOfStock,
  filterAndSortProducts,
  uniqueAbTestTags,
  uniqueCategories,
} from './filter';
import type { CatalogueProductFixture } from './types';

function money(amountMinor: number) {
  return { amountMinor, currency: 'USD' };
}

function product(
  overrides: Partial<CatalogueProductFixture> & { id: string },
): CatalogueProductFixture {
  return {
    externalProductId: `ext-${overrides.id}`,
    name: 'Untitled product',
    hasImage: true,
    status: 'ACTIVE',
    categoryPath: 'Category A',
    createdAt: '2026-08-01T00:00:00.000Z',
    abTestTag: null,
    unitsSold30d: 0,
    wishlistCount30d: 0,
    pageViews30d: 0,
    ratingAverage: null,
    ratingCount: 0,
    contentScore: 'GOOD',
    price: money(1000),
    compareAtPrice: null,
    totalStock: 10,
    active: true,
    editorFixtureKey: 'pass',
    variants: [],
    ...overrides,
  };
}

const DEFAULT_FILTERS: CatalogueFilters = {
  searchField: 'NAME',
  searchTerm: '',
  category: null,
  sort: 'CREATED_DESC',
  abTestTag: null,
  outOfStockOnly: false,
};

describe('countByStatus', () => {
  it('counts every status plus a grand total under ALL', () => {
    const products = [
      product({ id: 'a', status: 'ACTIVE' }),
      product({ id: 'b', status: 'ACTIVE' }),
      product({ id: 'c', status: 'DRAFT' }),
    ];

    expect(countByStatus(products)).toEqual({
      ALL: 3,
      ACTIVE: 2,
      INACTIVE: 0,
      DRAFT: 1,
      PENDING_QC: 0,
      VIOLATION: 0,
      DELETED: 0,
    });
  });
});

describe('filterAndSortProducts', () => {
  const products = [
    product({
      id: 'ready',
      name: 'Ready Product',
      status: 'ACTIVE',
      totalStock: 5,
      price: money(500),
      createdAt: '2026-08-01T00:00:00.000Z',
    }),
    product({
      id: 'draft',
      name: 'Draft Product',
      status: 'DRAFT',
      totalStock: 0,
      price: money(2000),
      createdAt: '2026-08-05T00:00:00.000Z',
    }),
  ];

  it('filters by the active status tab', () => {
    const result = filterAndSortProducts(products, 'DRAFT', DEFAULT_FILTERS);

    expect(result.map((p) => p.id)).toEqual(['draft']);
  });

  it('ALL tab returns every status', () => {
    const result = filterAndSortProducts(products, 'ALL', DEFAULT_FILTERS);

    expect(result).toHaveLength(2);
  });

  it('matches search by name, case-insensitively', () => {
    const result = filterAndSortProducts(products, 'ALL', {
      ...DEFAULT_FILTERS,
      searchTerm: 'ready',
    });

    expect(result.map((p) => p.id)).toEqual(['ready']);
  });

  it('filters to out-of-stock only', () => {
    const result = filterAndSortProducts(products, 'ALL', {
      ...DEFAULT_FILTERS,
      outOfStockOnly: true,
    });

    expect(result.map((p) => p.id)).toEqual(['draft']);
  });

  it('sorts by price ascending', () => {
    const result = filterAndSortProducts(products, 'ALL', {
      ...DEFAULT_FILTERS,
      sort: 'PRICE_ASC',
    });

    expect(result.map((p) => p.id)).toEqual(['ready', 'draft']);
  });

  it('sorts newest first by default', () => {
    const result = filterAndSortProducts(products, 'ALL', DEFAULT_FILTERS);

    expect(result.map((p) => p.id)).toEqual(['draft', 'ready']);
  });

  it('matches search by seller SKU across variants', () => {
    const withVariant = [
      product({
        id: 'has-sku',
        variants: [
          {
            id: 'v1',
            specsLabel: 'Size: M',
            sellerSku: 'ABC-123',
            hasImage: true,
            price: money(100),
            compareAtPrice: null,
            stock: 1,
            active: true,
          },
        ],
      }),
      product({ id: 'no-sku', variants: [] }),
    ];

    const result = filterAndSortProducts(withVariant, 'ALL', {
      ...DEFAULT_FILTERS,
      searchField: 'SELLER_SKU',
      searchTerm: 'abc-123',
    });

    expect(result.map((p) => p.id)).toEqual(['has-sku']);
  });
});

describe('uniqueCategories / uniqueAbTestTags / countOutOfStock', () => {
  it('deduplicates and sorts categories', () => {
    const products = [
      product({ id: 'a', categoryPath: 'Zeta' }),
      product({ id: 'b', categoryPath: 'Alpha' }),
      product({ id: 'c', categoryPath: 'Alpha' }),
    ];

    expect(uniqueCategories(products)).toEqual(['Alpha', 'Zeta']);
  });

  it('drops null tags from uniqueAbTestTags', () => {
    const products = [
      product({ id: 'a', abTestTag: 'Tag 1' }),
      product({ id: 'b', abTestTag: null }),
    ];

    expect(uniqueAbTestTags(products)).toEqual(['Tag 1']);
  });

  it('counts zero-stock products', () => {
    const products = [
      product({ id: 'a', totalStock: 0 }),
      product({ id: 'b', totalStock: 5 }),
    ];

    expect(countOutOfStock(products)).toBe(1);
  });
});
