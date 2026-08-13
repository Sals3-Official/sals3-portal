import { z } from 'zod';

/**
 * URL contract for **Product Catalogue** (`/listings`).
 *
 * Same convention as `pipeline-params.ts` and `supplier-products-params.ts`:
 * the view lives in the URL (shareable, back-button-correct, server-rendered
 * without client state), and every value is bounded or `.catch()`-defaulted so
 * a hand-edited URL degrades to the safe default instead of reaching the
 * database with something unexpected.
 *
 * Filtering, searching, and sorting are URL state rather than client state on
 * purpose: this page is paginated, so a client-side filter over the 25 loaded
 * rows would answer a question about one page while appearing to answer it
 * about the whole catalogue.
 */

export const LISTINGS_PATH = '/listings';

/**
 * Status filter values, lowercase in the URL. `all` is the default view.
 * These map one-to-one onto the real `product_publication_state` enum - see
 * `src/lib/seller-center/product-catalogue/status.ts` for the display side.
 */
export const LISTINGS_STATUS_FILTERS = [
  'all',
  'draft',
  'live',
  'paused',
  'archived',
] as const;

export type ListingsStatusFilter = (typeof LISTINGS_STATUS_FILTERS)[number];

/**
 * Which column a search term applies to, and the sort orders offered.
 *
 * They live in this pure module - not next to the SQL that consumes them -
 * because the client filter bar needs the same vocabulary, and importing it
 * from the query module would drag the database client into the browser bundle.
 */
export const LISTINGS_SEARCH_FIELDS = [
  'NAME',
  'SALS3_PRODUCT_ID',
  'SELLER_SKU',
  'SUPPLIER_REFERENCE',
] as const;

export type ListingsSearchField = (typeof LISTINGS_SEARCH_FIELDS)[number];

export const LISTINGS_SEARCH_FIELD_LABELS: Record<ListingsSearchField, string> =
  {
    NAME: 'Product name',
    SALS3_PRODUCT_ID: 'Sals3 Product ID',
    SELLER_SKU: 'Seller SKU',
    SUPPLIER_REFERENCE: 'Supplier reference (CJ ID)',
  };

export const LISTINGS_SORTS = [
  'CREATED_DESC',
  'CREATED_ASC',
  'TITLE_ASC',
  'UPDATED_DESC',
] as const;

export type ListingsSort = (typeof LISTINGS_SORTS)[number];

export const LISTINGS_SORT_LABELS: Record<ListingsSort, string> = {
  CREATED_DESC: 'Newest first',
  CREATED_ASC: 'Oldest first',
  TITLE_ASC: 'Title A–Z',
  UPDATED_DESC: 'Recently updated',
};

export const listingsQuerySchema = z.object({
  status: z.enum(LISTINGS_STATUS_FILTERS).catch('all').default('all'),
  q: z.string().trim().max(120).catch('').default(''),
  /** Which column the search term applies to. */
  field: z.enum(LISTINGS_SEARCH_FIELDS).catch('NAME').default('NAME'),
  /** A `sals3_categories.id`; `''` means no category filter. */
  category: z.string().trim().uuid().catch('').default(''),
  /** A `supplier_providers.code`; `''` means no supplier filter. */
  supplier: z.string().trim().max(64).catch('').default(''),
  sort: z.enum(LISTINGS_SORTS).catch('CREATED_DESC').default('CREATED_DESC'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export type ListingsQuery = z.infer<typeof listingsQuerySchema>;

/** Only the keys that are set, so hrefs never emit `?q=&page=`. */
export function listingsCurrentParams(
  query: ListingsQuery,
): Record<string, string> {
  return {
    ...(query.status === 'all' ? {} : { status: query.status }),
    ...(query.q === '' ? {} : { q: query.q }),
    ...(query.field === 'NAME' ? {} : { field: query.field }),
    ...(query.category === '' ? {} : { category: query.category }),
    ...(query.supplier === '' ? {} : { supplier: query.supplier }),
    ...(query.sort === 'CREATED_DESC' ? {} : { sort: query.sort }),
    ...(query.page === 1 ? {} : { page: String(query.page) }),
  };
}
