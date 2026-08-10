import { describe, expect, it } from 'vitest';
import type { CatalogueFilters } from '@/components/products/catalogue/CatalogueFilterBar';
import {
  countByStatus,
  countNeedsAttention,
  countOutOfStock,
  filterAndSortProducts,
  uniqueCategories,
  uniqueSupplierProviders,
} from './filter';
import type {
  AttentionReasonFixture,
  CatalogueProductFixture,
  CatalogueVariantFixture,
} from './types';

function money(amountMinor: number) {
  return { amountMinor, currency: 'USD' };
}

function variant(
  overrides: Partial<CatalogueVariantFixture> & { id: string },
): CatalogueVariantFixture {
  return {
    optionLabel: 'Size: M',
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

const DEFAULT_FILTERS: CatalogueFilters = {
  searchField: 'NAME',
  searchTerm: '',
  category: null,
  supplierProviderCode: null,
  availability: null,
  mediaStatus: null,
  evidenceFreshness: null,
  needsAttentionOnly: false,
  outOfStockOnly: false,
  sort: 'CREATED_DESC',
};

describe('countByStatus', () => {
  it('counts every listing status plus a grand total under ALL', () => {
    const products = [
      product({ id: 'a', status: 'LIVE' }),
      product({ id: 'b', status: 'LIVE' }),
      product({ id: 'c', status: 'DRAFT' }),
    ];

    expect(countByStatus(products)).toEqual({
      ALL: 3,
      DRAFT: 1,
      LIVE: 2,
      LIVE_NEEDS_ATTENTION: 0,
      AUTO_PAUSED: 0,
      ARCHIVED: 0,
    });
  });
});

describe('filterAndSortProducts', () => {
  const products = [
    product({
      id: 'ready',
      name: 'Ready Product',
      status: 'LIVE',
      sellingPrice: money(500),
      createdAt: '2026-08-01T00:00:00.000Z',
      cjProductId: 'CJ-READY-1',
      sals3ProductId: 'SALS3-P-READY',
    }),
    product({
      id: 'draft',
      name: 'Draft Product',
      status: 'DRAFT',
      sellingPrice: money(2000),
      createdAt: '2026-08-05T00:00:00.000Z',
      availability: 'OUT_OF_STOCK',
      cjProductId: 'CJ-DRAFT-1',
      sals3ProductId: 'SALS3-P-DRAFT',
    }),
  ];

  it('filters by the active listing-status tab', () => {
    const result = filterAndSortProducts(products, 'DRAFT', DEFAULT_FILTERS);

    expect(result.map((p) => p.id)).toEqual(['draft']);
  });

  it('ALL tab returns every listing status', () => {
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

  it('matches search by Sals3 Product ID', () => {
    const result = filterAndSortProducts(products, 'ALL', {
      ...DEFAULT_FILTERS,
      searchField: 'SALS3_PRODUCT_ID',
      searchTerm: 'SALS3-P-DRAFT',
    });

    expect(result.map((p) => p.id)).toEqual(['draft']);
  });

  it('matches search by supplier reference (CJ product ID), never confused with the Sals3 Product ID field', () => {
    const result = filterAndSortProducts(products, 'ALL', {
      ...DEFAULT_FILTERS,
      searchField: 'SUPPLIER_REFERENCE',
      searchTerm: 'CJ-READY-1',
    });

    expect(result.map((p) => p.id)).toEqual(['ready']);
  });

  it('matches search by seller SKU across variants', () => {
    const withVariant = [
      product({
        id: 'has-sku',
        variants: [variant({ id: 'v1', sellerSku: 'ABC-123' })],
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

  it('filters to out-of-stock only using derived availability, not a raw stock number', () => {
    const result = filterAndSortProducts(products, 'ALL', {
      ...DEFAULT_FILTERS,
      outOfStockOnly: true,
    });

    expect(result.map((p) => p.id)).toEqual(['draft']);
  });

  it('filters to needs-attention only', () => {
    const withAttention = [
      product({ id: 'clear', attentionReasons: [] }),
      product({
        id: 'flagged',
        attentionReasons: [attentionReason({ id: 'r1' })],
      }),
    ];

    const result = filterAndSortProducts(withAttention, 'ALL', {
      ...DEFAULT_FILTERS,
      needsAttentionOnly: true,
    });

    expect(result.map((p) => p.id)).toEqual(['flagged']);
  });

  it('filters by supplier provider code', () => {
    const multiSupplier = [
      product({ id: 'cj', supplierProviderCode: 'cj-dropshipping' }),
      product({ id: 'other', supplierProviderCode: 'other-provider' }),
    ];

    const result = filterAndSortProducts(multiSupplier, 'ALL', {
      ...DEFAULT_FILTERS,
      supplierProviderCode: 'other-provider',
    });

    expect(result.map((p) => p.id)).toEqual(['other']);
  });

  it('filters by media status', () => {
    const mixedMedia = [
      product({ id: 'own', mediaStatus: 'OWN_PICTURES' }),
      product({ id: 'fallback', mediaStatus: 'SUPPLIER_FALLBACK' }),
    ];

    const result = filterAndSortProducts(mixedMedia, 'ALL', {
      ...DEFAULT_FILTERS,
      mediaStatus: 'SUPPLIER_FALLBACK',
    });

    expect(result.map((p) => p.id)).toEqual(['fallback']);
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

  it('sorts most urgent attention first', () => {
    const withSeverity = [
      product({
        id: 'low',
        attentionReasons: [attentionReason({ id: 'r1', severity: 'LOW' })],
      }),
      product({
        id: 'critical',
        attentionReasons: [attentionReason({ id: 'r2', severity: 'CRITICAL' })],
      }),
      product({ id: 'clear', attentionReasons: [] }),
    ];

    const result = filterAndSortProducts(withSeverity, 'ALL', {
      ...DEFAULT_FILTERS,
      sort: 'ATTENTION_SEVERITY_DESC',
    });

    expect(result.map((p) => p.id)).toEqual(['critical', 'low', 'clear']);
  });
});

describe('uniqueCategories / uniqueSupplierProviders / countOutOfStock / countNeedsAttention', () => {
  it('deduplicates and sorts categories', () => {
    const products = [
      product({ id: 'a', categoryPath: 'Zeta' }),
      product({ id: 'b', categoryPath: 'Alpha' }),
      product({ id: 'c', categoryPath: 'Alpha' }),
    ];

    expect(uniqueCategories(products)).toEqual(['Alpha', 'Zeta']);
  });

  it('deduplicates supplier providers by code', () => {
    const products = [
      product({
        id: 'a',
        supplierProviderCode: 'cj-dropshipping',
        supplierProviderName: 'CJ Dropshipping',
      }),
      product({
        id: 'b',
        supplierProviderCode: 'cj-dropshipping',
        supplierProviderName: 'CJ Dropshipping',
      }),
    ];

    expect(uniqueSupplierProviders(products)).toEqual([
      { code: 'cj-dropshipping', name: 'CJ Dropshipping' },
    ]);
  });

  it('counts out-of-stock products using derived availability', () => {
    const products = [
      product({ id: 'a', availability: 'OUT_OF_STOCK' }),
      product({ id: 'b', availability: 'AVAILABLE' }),
    ];

    expect(countOutOfStock(products)).toBe(1);
  });

  it('counts products with at least one open attention reason', () => {
    const products = [
      product({
        id: 'a',
        attentionReasons: [attentionReason({ id: 'r1' })],
      }),
      product({ id: 'b', attentionReasons: [] }),
    ];

    expect(countNeedsAttention(products)).toBe(1);
  });
});
