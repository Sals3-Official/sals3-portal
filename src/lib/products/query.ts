import { PRODUCT_STATUSES, PRODUCTS_PAGE_SIZE } from './constants';
import type {
  Product,
  ProductListQuery,
  ProductListResult,
  ProductSortKey,
  ProductStatus,
} from './types';

/** Total stock across every variant. */
export function totalStock(product: Product): number {
  return product.variants.reduce((sum, variant) => sum + variant.stock, 0);
}

/** The price a shopper pays: the sale price when set, else the regular price. */
export function effectivePriceMinor(product: Product): number {
  return product.pricing.saleMinor ?? product.pricing.regularMinor;
}

/** Matches the search box against the name, SKU, barcode, and variant SKUs. */
export function matchesSearch(product: Product, term: string): boolean {
  const needle = term.trim().toLowerCase();

  if (needle === '') {
    return true;
  }

  const haystack = [
    product.name,
    product.identifiers.sku,
    product.identifiers.barcode ?? '',
    product.identifiers.upc ?? '',
    product.identifiers.ean ?? '',
    ...product.variants.map((variant) => variant.sku),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}

const comparators: Record<ProductSortKey, (a: Product, b: Product) => number> =
  {
    'updated-desc': (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    'updated-asc': (a, b) => a.updatedAt.localeCompare(b.updatedAt),
    'name-asc': (a, b) => a.name.localeCompare(b.name),
    'name-desc': (a, b) => b.name.localeCompare(a.name),
    'price-asc': (a, b) => effectivePriceMinor(a) - effectivePriceMinor(b),
    'price-desc': (a, b) => effectivePriceMinor(b) - effectivePriceMinor(a),
    'stock-asc': (a, b) => totalStock(a) - totalStock(b),
    'stock-desc': (a, b) => totalStock(b) - totalStock(a),
  };

export function sortProducts(
  products: Product[],
  sort: ProductSortKey,
): Product[] {
  return [...products].sort(comparators[sort]);
}

/** Counts per status for the tab row. Ignores the status filter itself. */
export function countByStatus(
  products: Product[],
): Record<ProductStatus | 'all', number> {
  const counts = { all: products.length } as Record<
    ProductStatus | 'all',
    number
  >;

  PRODUCT_STATUSES.forEach((status) => {
    counts[status] = products.filter(
      (product) => product.status === status,
    ).length;
  });

  return counts;
}

/**
 * Filters, sorts, and pages the catalogue. Pure so it can be unit tested and
 * reused when a real repository replaces the in-memory fixture.
 */
export function queryProducts(
  products: Product[],
  query: ProductListQuery,
): ProductListResult {
  const searched = products.filter(
    (product) =>
      matchesSearch(product, query.q) &&
      (query.category === 'all' || product.category === query.category) &&
      (query.brand === 'all' || product.brand === query.brand),
  );

  const statusCounts = countByStatus(searched);

  const filtered =
    query.status === 'all'
      ? searched
      : searched.filter((product) => product.status === query.status);

  const perPage = query.perPage > 0 ? query.perPage : PRODUCTS_PAGE_SIZE;
  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * perPage;

  return {
    products: sortProducts(filtered, query.sort).slice(start, start + perPage),
    totalCount,
    totalPages,
    page,
    statusCounts,
  };
}

/** True when any filter narrows the list, so the UI can offer "Clear". */
export function hasActiveFilters(query: ProductListQuery): boolean {
  return (
    query.q !== '' ||
    query.status !== 'all' ||
    query.category !== 'all' ||
    query.brand !== 'all'
  );
}
