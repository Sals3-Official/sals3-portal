import { describe, expect, it } from 'vitest';
import type { CatalogPage } from '@/modules/suppliers/contracts';
import type { CjProduct } from '@/lib/cj/normalize';
import validateCatalogPage, {
  validateSinglePageCompleteness,
} from './page-validation';

function product(id: string): CjProduct {
  return {
    id,
    name: 'Plain phone case',
    sku: `SKU-${id}`,
    imageUrl: null,
    category: 'Phone accessories',
    priceCentsUsd: 500,
    weight: '100 g',
    productType: 'accessory',
    supplier: 'CJ',
    freeShipping: false,
    shipsFrom: ['CN'],
    listedCount: 10,
    createdAt: null,
  };
}

function page(overrides: Partial<CatalogPage> = {}): CatalogPage {
  const products = overrides.products ?? [product('p1'), product('p2')];
  const total = overrides.total ?? products.length;
  const pageSize = overrides.pageSize ?? 200;

  return {
    products,
    requestedPageNum: 1,
    pageNum: 1,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
    pointsInfo: null,
    ...overrides,
  };
}

const EXPECT_PAGE_1 = { requestedPageNum: 1, requestedPageSize: 200 };

describe('validateCatalogPage - the complete invalid-pagination matrix', () => {
  it('accepts a well-formed page', () => {
    expect(validateCatalogPage(page(), EXPECT_PAGE_1)).toEqual({ ok: true });
  });

  it('accepts totals of exactly 6,000 and far greater - ordinary density, never a V2-cap decision', () => {
    [6_000, 6_001, 50_000, 1_000_000].forEach((total) => {
      const dense = page({
        products: Array.from({ length: 200 }, (_, i) => product(`p${i}`)),
        total,
        totalPages: Math.ceil(total / 200),
      });

      expect(validateCatalogPage(dense, EXPECT_PAGE_1)).toEqual({ ok: true });
    });
  });

  it('rejects a returned page identity that differs from the requested page', () => {
    const result = validateCatalogPage(page({ pageNum: 3 }), EXPECT_PAGE_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_PAGE_IDENTITY_MISMATCH');
  });

  it('rejects a non-integer page identity', () => {
    const result = validateCatalogPage(page({ pageNum: 1.5 }), EXPECT_PAGE_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_PAGE_IDENTITY_INVALID');
  });

  it.each([
    ['non-integer', 10.5],
    ['non-positive', 0],
    ['negative', -5],
  ])('rejects a %s page size', (_label, pageSize) => {
    const result = validateCatalogPage(page({ pageSize }), EXPECT_PAGE_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_PAGE_SIZE_INVALID');
  });

  it('rejects a page size exceeding the requested/documented maximum', () => {
    const result = validateCatalogPage(
      page({ pageSize: 500, totalPages: 1 }),
      EXPECT_PAGE_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_PAGE_SIZE_EXCEEDED');
  });

  it.each([
    ['negative', -1],
    ['non-integer', 10.7],
  ])('rejects a %s total', (_label, total) => {
    const result = validateCatalogPage(page({ total }), EXPECT_PAGE_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_TOTAL_INVALID');
  });

  it('rejects total pages inconsistent with the reported total and page size', () => {
    const result = validateCatalogPage(
      page({ total: 300, totalPages: 5 }),
      EXPECT_PAGE_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_TOTAL_PAGES_INVALID');
  });

  it('rejects a page outside the valid non-empty range', () => {
    const result = validateCatalogPage(
      page({ pageNum: 4, total: 300, totalPages: 2 }),
      { requestedPageNum: 4, requestedPageSize: 200 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_PAGE_OUT_OF_RANGE');
  });

  it('rejects a product count exceeding the declared page size', () => {
    const result = validateCatalogPage(
      page({
        products: [product('p1'), product('p2'), product('p3')],
        pageSize: 2,
        total: 3,
        totalPages: 2,
      }),
      { requestedPageNum: 1, requestedPageSize: 2 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_PAGE_OVERFLOW');
  });

  it('rejects an empty page while the metadata says records remain', () => {
    const result = validateCatalogPage(
      page({ products: [], total: 100, totalPages: 1 }),
      EXPECT_PAGE_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_EMPTY_PAGE_WITH_REMAINING_TOTAL');
  });

  it('rejects total=0 with non-empty content', () => {
    const result = validateCatalogPage(
      page({ products: [product('p1')], total: 0, totalPages: 1 }),
      EXPECT_PAGE_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_ZERO_TOTAL_WITH_CONTENT');
  });

  it('accepts a genuinely empty result set', () => {
    const result = validateCatalogPage(
      page({ products: [], total: 0, totalPages: 1 }),
      EXPECT_PAGE_1,
    );

    expect(result).toEqual({ ok: true });
  });

  it('rejects a malformed required product identity', () => {
    const broken = { ...product('p1'), id: '   ' };
    const result = validateCatalogPage(
      page({ products: [broken], total: 1, totalPages: 1 }),
      EXPECT_PAGE_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_PRODUCT_IDENTITY_MALFORMED');
  });
});

describe('validateSinglePageCompleteness', () => {
  it('rejects duplicate identities that make an allegedly complete <=200 partition inconsistent with total', () => {
    const result = validateSinglePageCompleteness(
      page({
        products: [product('p1'), product('p1'), product('p2')],
        total: 3,
        totalPages: 1,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('PROVIDER_UNIQUE_COUNT_MISMATCH');
  });

  it('accepts a unique PID set equal to the reported total', () => {
    const result = validateSinglePageCompleteness(
      page({
        products: [product('p1'), product('p2')],
        total: 2,
        totalPages: 1,
      }),
    );

    expect(result).toEqual({ ok: true });
  });
});
