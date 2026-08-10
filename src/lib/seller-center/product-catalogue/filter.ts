import type { CatalogueFilters } from '@/components/products/catalogue/CatalogueFilterBar';
import type { CatalogueProductFixture, CatalogueStatus } from './types';

/**
 * Pure filter/sort/count logic, kept out of the client component so it can
 * be unit-tested directly rather than only through rendered DOM assertions
 * - the same split `derive.ts` uses for the Product Editor.
 */

export function countByStatus(
  products: CatalogueProductFixture[],
): Record<CatalogueStatus | 'ALL', number> {
  const counts = {
    ALL: products.length,
    ACTIVE: 0,
    INACTIVE: 0,
    DRAFT: 0,
    PENDING_QC: 0,
    VIOLATION: 0,
    DELETED: 0,
  } as Record<CatalogueStatus | 'ALL', number>;

  products.forEach((product) => {
    counts[product.status] += 1;
  });

  return counts;
}

function matchesSearch(
  product: CatalogueProductFixture,
  field: CatalogueFilters['searchField'],
  term: string,
): boolean {
  const needle = term.trim().toLowerCase();

  if (needle === '') return true;

  if (field === 'NAME') return product.name.toLowerCase().includes(needle);
  if (field === 'PRODUCT_ID') {
    return product.externalProductId.toLowerCase().includes(needle);
  }

  return product.variants.some((variant) =>
    variant.sellerSku.toLowerCase().includes(needle),
  );
}

export function filterAndSortProducts(
  products: CatalogueProductFixture[],
  activeTab: CatalogueStatus | 'ALL',
  filters: CatalogueFilters,
): CatalogueProductFixture[] {
  const filtered = products.filter((product) => {
    if (activeTab !== 'ALL' && product.status !== activeTab) return false;
    if (!matchesSearch(product, filters.searchField, filters.searchTerm)) {
      return false;
    }
    if (
      filters.category !== null &&
      product.categoryPath !== filters.category
    ) {
      return false;
    }
    if (filters.abTestTag !== null && product.abTestTag !== filters.abTestTag) {
      return false;
    }
    if (filters.outOfStockOnly && product.totalStock !== 0) return false;

    return true;
  });

  const sorted = [...filtered];

  switch (filters.sort) {
    case 'PRICE_ASC':
      sorted.sort((a, b) => a.price.amountMinor - b.price.amountMinor);
      break;
    case 'PRICE_DESC':
      sorted.sort((a, b) => b.price.amountMinor - a.price.amountMinor);
      break;
    case 'STOCK_ASC':
      sorted.sort((a, b) => a.totalStock - b.totalStock);
      break;
    case 'STOCK_DESC':
      sorted.sort((a, b) => b.totalStock - a.totalStock);
      break;
    case 'UNITS_SOLD_DESC':
      sorted.sort((a, b) => b.unitsSold30d - a.unitsSold30d);
      break;
    case 'CREATED_DESC':
    default:
      sorted.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }

  return sorted;
}

export function uniqueCategories(
  products: CatalogueProductFixture[],
): string[] {
  return [...new Set(products.map((product) => product.categoryPath))].sort();
}

export function uniqueAbTestTags(
  products: CatalogueProductFixture[],
): string[] {
  return [
    ...new Set(
      products
        .map((product) => product.abTestTag)
        .filter((tag): tag is string => tag !== null),
    ),
  ].sort();
}

export function countOutOfStock(products: CatalogueProductFixture[]): number {
  return products.filter((product) => product.totalStock === 0).length;
}
