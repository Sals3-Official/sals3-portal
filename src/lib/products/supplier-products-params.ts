import { z } from 'zod';

/**
 * URL contract for **All Supplier Products**.
 *
 * The page keeps its quick view, filters, search, and page in the URL, which
 * is this codebase's existing list-view convention: a view is shareable, the
 * back button behaves, and the Server Component renders without client state.
 *
 * Every value is bounded or `.catch()`-defaulted, so a hand-edited URL
 * degrades to the safe default rather than reaching the database with
 * something unexpected. None of these parameters can produce a supplier
 * request - every one of them is answered from the Sals3 database.
 */

export const SUPPLIER_PRODUCTS_QUICK_VIEWS = [
  'all',
  'cj-trending',
  'most-listed',
  'new-arrivals',
  'needs-attention',
] as const;

export const DISCOVERY_SIGNAL_FILTERS = [
  'ALL',
  'CJ_TRENDING',
  'CJ_HIGH_LISTED',
  'CJ_NEW_ARRIVAL',
  'NONE',
] as const;

export const supplierProductsQuerySchema = z.object({
  view: z.enum(SUPPLIER_PRODUCTS_QUICK_VIEWS).catch('all').default('all'),
  signal: z.enum(DISCOVERY_SIGNAL_FILTERS).catch('ALL').default('ALL'),
  /** Provider category id, matched against the persisted Sals3 column. */
  category: z.string().trim().max(120).catch('').default(''),
  /**
   * Raw typed term. The minimum-length rule lives in the query layer
   * (`normalizeSearchTerm`), not here, so the server and the client agree on
   * exactly one definition of "too short to search".
   */
  q: z.string().trim().max(120).catch('').default(''),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  /**
   * Candidate UUID whose read-only Supplier Source Details drawer is open.
   * Retired URLs used `source=cj`; rejecting non-UUID values here keeps them
   * harmless instead of passing them into a UUID database predicate.
   */
  source: z.string().trim().uuid().catch('').default(''),
});

export type SupplierProductsQuery = z.infer<typeof supplierProductsQuerySchema>;

export const QUICK_VIEW_LABELS: Record<
  (typeof SUPPLIER_PRODUCTS_QUICK_VIEWS)[number],
  string
> = {
  all: 'All products',
  'cj-trending': 'CJ Trending',
  'most-listed': 'Most listed',
  'new-arrivals': 'New arrivals',
  'needs-attention': 'Needs attention',
};

export const SIGNAL_FILTER_LABELS: Record<
  (typeof DISCOVERY_SIGNAL_FILTERS)[number],
  string
> = {
  ALL: 'All products',
  CJ_TRENDING: 'CJ Trending',
  CJ_HIGH_LISTED: 'Most listed on CJ',
  CJ_NEW_ARRIVAL: 'New arrivals',
  NONE: 'No CJ signal yet',
};
