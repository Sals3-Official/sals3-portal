import { describe, expect, it } from 'vitest';
import buildFixtureCatalogue from './fixtures';
import {
  countByStatus,
  effectivePriceMinor,
  hasActiveFilters,
  matchesSearch,
  queryProducts,
  sortProducts,
  totalStock,
} from './query';
import { productListQuerySchema } from './schemas';
import type { Product } from './types';

const catalogue = buildFixtureCatalogue();

function query(overrides: Record<string, string | number> = {}) {
  return productListQuerySchema.parse(overrides);
}

function byId(id: string): Product {
  const product = catalogue.find((item) => item.id === id);

  if (product === undefined) {
    throw new Error(`Fixture ${id} is missing`);
  }

  return product;
}

describe('totalStock', () => {
  it('adds the stock of every variant', () => {
    expect(totalStock(byId('air-cooler'))).toBe(16);
  });
});

describe('effectivePriceMinor', () => {
  it('uses the sale price when one is set', () => {
    expect(effectivePriceMinor(byId('air-cooler'))).toBe(199900);
  });

  it('uses the regular price when there is no sale', () => {
    expect(effectivePriceMinor(byId('nightstand-lamp'))).toBe(89900);
  });
});

describe('matchesSearch', () => {
  const product = byId('air-cooler');

  it('matches part of the name, ignoring case', () => {
    expect(matchesSearch(product, 'TOWER')).toBe(true);
  });

  it('matches the product SKU', () => {
    expect(matchesSearch(product, 'air-cooler')).toBe(true);
  });

  it('matches the barcode', () => {
    expect(matchesSearch(product, 'SALS3-00001')).toBe(true);
  });

  it('does not match an unrelated word', () => {
    expect(matchesSearch(product, 'bicycle')).toBe(false);
  });

  it('treats an empty search as no filter', () => {
    expect(matchesSearch(product, '   ')).toBe(true);
  });
});

describe('sortProducts', () => {
  it('sorts by price from low to high', () => {
    const prices = sortProducts(catalogue, 'price-asc').map(
      effectivePriceMinor,
    );

    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('sorts by name from A to Z', () => {
    const names = sortProducts(catalogue, 'name-asc').map(
      (product) => product.name,
    );

    expect(names[0]).toBe('All-terrain waterproof sandals');
  });

  it('does not change the array it receives', () => {
    const before = catalogue.map((product) => product.id);

    sortProducts(catalogue, 'name-desc');

    expect(catalogue.map((product) => product.id)).toEqual(before);
  });
});

describe('countByStatus', () => {
  it('counts every status and the total', () => {
    const counts = countByStatus(catalogue);

    expect(counts.all).toBe(catalogue.length);
    expect(counts.published).toBe(6);
    expect(counts.draft).toBe(2);
    expect(counts.pending_approval).toBe(2);
    expect(counts.rejected).toBe(1);
    expect(counts.archived).toBe(1);
  });
});

describe('queryProducts', () => {
  it('filters by status', () => {
    const result = queryProducts(catalogue, query({ status: 'draft' }));

    expect(result.products).toHaveLength(2);
    expect(result.products.every((product) => product.status === 'draft')).toBe(
      true,
    );
  });

  it('filters by category and brand together', () => {
    const result = queryProducts(
      catalogue,
      query({ category: 'home-living', brand: 'casapura' }),
    );

    expect(result.products.map((product) => product.id).sort()).toEqual([
      'air-cooler',
      'linen-duvet',
      'nightstand-lamp',
    ]);
  });

  it('keeps status counts based on the other filters, not the status filter', () => {
    const result = queryProducts(
      catalogue,
      query({ category: 'electronics', status: 'draft' }),
    );

    expect(result.products).toHaveLength(1);
    expect(result.statusCounts.all).toBe(2);
    expect(result.statusCounts.rejected).toBe(1);
  });

  it('pages the results', () => {
    const first = queryProducts(catalogue, query({ perPage: 5, page: 1 }));
    const second = queryProducts(catalogue, query({ perPage: 5, page: 2 }));

    expect(first.products).toHaveLength(5);
    expect(first.totalPages).toBe(3);
    expect(second.products[0].id).not.toBe(first.products[0].id);
  });

  it('clamps a page number past the end back to the last page', () => {
    const result = queryProducts(catalogue, query({ perPage: 5, page: 99 }));

    expect(result.page).toBe(3);
    expect(result.products.length).toBeGreaterThan(0);
  });

  it('returns an empty page when nothing matches', () => {
    const result = queryProducts(catalogue, query({ q: 'no such product' }));

    expect(result.products).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(1);
  });
});

describe('hasActiveFilters', () => {
  it('is false for the default view', () => {
    expect(hasActiveFilters(query())).toBe(false);
  });

  it('is true when a search word is set', () => {
    expect(hasActiveFilters(query({ q: 'lamp' }))).toBe(true);
  });

  it('ignores sort and page, which are not filters', () => {
    expect(hasActiveFilters(query({ sort: 'name-asc', page: 3 }))).toBe(false);
  });
});
