import { z } from 'zod';
import { SELLER_CENTER_MARKET_CODES } from '@/lib/seller-center/market-config';
import type {
  EvaluationStatus,
  ListingState,
  StockAvailability,
  SupplierCatalogWorld,
  SupplierConnectionFixture,
  SupplierProductFixture,
} from './catalog-types';
import { listingStateOf } from './catalog-types';
import { isUsableAsFilter } from './catalog-presentation';

/**
 * URL query contract for the redesign preview (spec section 6: "Filters
 * persisted in URL query parameters"). Multi-value filters are comma-joined,
 * matching this app's existing single-level query-string convention rather
 * than introducing `?status[]=`.
 */
export const allSupplierProductsQuerySchema = z.object({
  scenario: z.string().catch('multi-healthy').default('multi-healthy'),
  q: z.string().catch('').default(''),
  supplier: z.string().catch('all').default('all'),
  status: z.string().catch('').default(''),
  category: z.string().catch('all').default('all'),
  stock: z.string().catch('').default(''),
  shipsFrom: z.string().catch('').default(''),
  market: z.string().catch('all').default('all'),
  listing: z.string().catch('').default(''),
  sort: z
    .enum([
      'recently-updated',
      'recently-added',
      'price-asc',
      'price-desc',
      'evaluation-status',
      'name',
    ])
    .catch('recently-updated')
    .default('recently-updated'),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export type AllSupplierProductsQuery = z.infer<
  typeof allSupplierProductsQuerySchema
>;

export const PAGE_SIZE = 8;

function csv(value: string): string[] {
  return value === '' ? [] : value.split(',').filter((part) => part !== '');
}

export const DESTINATION_MARKET_CODES = SELLER_CENTER_MARKET_CODES;

/** "Not yet queued" has no real enum value - `status=NOT_QUEUED` is this filter's own sentinel. */
export const NOT_QUEUED_SENTINEL = 'NOT_QUEUED';

function matchesStatus(
  product: SupplierProductFixture,
  selected: string[],
): boolean {
  if (selected.length === 0) return true;

  if (product.evaluationStatus === null) {
    return selected.includes(NOT_QUEUED_SENTINEL);
  }

  return selected.includes(product.evaluationStatus);
}

function matchesSearch(product: SupplierProductFixture, term: string): boolean {
  if (term === '') return true;

  const haystack = [
    product.title,
    product.normalizedTitle ?? '',
    product.externalProductId,
    product.category,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(term.toLowerCase());
}

export type FilterableWorld = {
  connections: SupplierConnectionFixture[];
  products: SupplierProductFixture[];
};

/**
 * Applies every toolbar/drawer filter. Connection scoping (which suppliers
 * are even eligible to appear) happens before this - see
 * `usableConnections()` - so a disconnected/revoked supplier's products
 * never reach here regardless of what `?supplier=` asks for.
 */
export function filterProducts(
  world: FilterableWorld,
  query: AllSupplierProductsQuery,
): SupplierProductFixture[] {
  const statusFilter = csv(query.status);
  const stockFilter = csv(query.stock) as StockAvailability[];
  const shipsFromFilter = csv(query.shipsFrom);
  const listingFilter = csv(query.listing) as ListingState[];
  const usableIds = new Set(
    world.connections
      .filter((connection) => isUsableAsFilter(connection.status))
      .map((connection) => connection.id),
  );

  return world.products.filter((product) => {
    if (!usableIds.has(product.connectionId)) return false;
    if (query.supplier !== 'all' && product.connectionId !== query.supplier) {
      return false;
    }
    if (!matchesSearch(product, query.q)) return false;
    if (!matchesStatus(product, statusFilter)) return false;
    if (query.category !== 'all' && product.category !== query.category) {
      return false;
    }
    if (stockFilter.length > 0 && !stockFilter.includes(product.stock)) {
      return false;
    }
    if (
      shipsFromFilter.length > 0 &&
      !product.shipsFrom.some((origin) => shipsFromFilter.includes(origin))
    ) {
      return false;
    }
    if (
      query.market !== 'all' &&
      !product.eligibleMarkets.includes(query.market)
    ) {
      return false;
    }
    if (
      listingFilter.length > 0 &&
      !listingFilter.includes(listingStateOf(product.existingListingsCount))
    ) {
      return false;
    }

    return true;
  });
}

const EVALUATION_SORT_RANK: Record<EvaluationStatus | 'NOT_QUEUED', number> = {
  BLOCKED: 0,
  EVALUATION_FAILED: 1,
  TEMPORARILY_INELIGIBLE: 2,
  NOT_QUEUED: 3,
  QUEUED: 4,
  EVALUATING: 5,
  PASS_WITH_ATTENTION: 6,
  PASS: 7,
};

/**
 * Supplier currencies are not directly comparable (spec section 12), so
 * price sort only ever compares rows sharing one currency - mixed-currency
 * results keep their relative order instead of being ranked against each
 * other on a number that would be misleading.
 */
export function sortProducts(
  products: SupplierProductFixture[],
  sort: AllSupplierProductsQuery['sort'],
): SupplierProductFixture[] {
  const sorted = [...products];

  switch (sort) {
    case 'recently-updated':
      sorted.sort(
        (a, b) =>
          new Date(b.lastSupplierUpdateAt).getTime() -
          new Date(a.lastSupplierUpdateAt).getTime(),
      );
      break;
    case 'recently-added':
      sorted.sort((a, b) => a.id.localeCompare(b.id));
      break;
    case 'price-asc':
      sorted.sort((a, b) => {
        if (a.supplierCurrency !== b.supplierCurrency) return 0;

        return a.supplierPriceMinor - b.supplierPriceMinor;
      });
      break;
    case 'price-desc':
      sorted.sort((a, b) => {
        if (a.supplierCurrency !== b.supplierCurrency) return 0;

        return b.supplierPriceMinor - a.supplierPriceMinor;
      });
      break;
    case 'evaluation-status':
      sorted.sort(
        (a, b) =>
          EVALUATION_SORT_RANK[a.evaluationStatus ?? 'NOT_QUEUED'] -
          EVALUATION_SORT_RANK[b.evaluationStatus ?? 'NOT_QUEUED'],
      );
      break;
    case 'name':
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default:
      break;
  }

  return sorted;
}

export function distinctCurrencies(
  products: SupplierProductFixture[],
): string[] {
  return [...new Set(products.map((product) => product.supplierCurrency))];
}

export function usableConnections(
  world: SupplierCatalogWorld,
): SupplierConnectionFixture[] {
  return world.connections.filter((connection) =>
    isUsableAsFilter(connection.status),
  );
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number = PAGE_SIZE,
): { pageItems: T[]; totalPages: number; page: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;

  return {
    pageItems: items.slice(start, start + pageSize),
    totalPages,
    page: clampedPage,
  };
}
