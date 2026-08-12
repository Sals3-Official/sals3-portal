import { z } from 'zod';

/**
 * URL contract for **All Supplier Products** (live CJ browse).
 *
 * The page keeps its view, filters, search, and page in the URL, which is
 * this codebase's existing list-view convention: a view is shareable, the
 * back button behaves, and the Server Component renders without client state.
 *
 * Every value is bounded or `.catch()`-defaulted, so a hand-edited URL
 * degrades to the safe default rather than reaching CJ or the database with
 * something unexpected. Retired values from the saved-data era - the
 * `cj-trending`/`needs-attention` views and the whole `signal` filter -
 * degrade to the default view instead of erroring.
 */

export const SUPPLIER_PRODUCTS_QUICK_VIEWS = [
  'all',
  'most-listed',
  'new-arrivals',
] as const;

export const supplierProductsQuerySchema = z.object({
  view: z.enum(SUPPLIER_PRODUCTS_QUICK_VIEWS).catch('all').default('all'),
  /** Provider category id, sent to CJ as the documented `categoryId` filter. */
  category: z.string().trim().max(120).catch('').default(''),
  /** Sent to CJ as the documented `productNameEn` name filter. */
  q: z.string().trim().max(120).catch('').default(''),
  /**
   * Clamped to 500 like the storefront feed: CJ paging past the real result
   * depth degrades into body-level errors, so an unbounded page number only
   * manufactures failed supplier calls.
   */
  page: z.coerce.number().int().min(1).max(500).catch(1).default(1),
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
  'most-listed': 'Most listed',
  'new-arrivals': 'New arrivals',
};

/**
 * Live CJ ordering for each view. `all` sends no ordering at all - the
 * provider's default ranking - while the other views use the two documented
 * legacy `orderBy` values.
 */
export const QUICK_VIEW_ORDERING: Record<
  (typeof SUPPLIER_PRODUCTS_QUICK_VIEWS)[number],
  { orderBy: 'createAt' | 'listedNum'; sort: 'asc' | 'desc' } | null
> = {
  all: null,
  'most-listed': { orderBy: 'listedNum', sort: 'desc' },
  'new-arrivals': { orderBy: 'createAt', sort: 'desc' },
};
