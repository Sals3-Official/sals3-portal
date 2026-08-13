import { z } from 'zod';

/**
 * URL contract for **Product Catalogue** (`/listings`).
 *
 * Same convention as `pipeline-params.ts` and `supplier-products-params.ts`:
 * the view lives in the URL (shareable, back-button-correct, server-rendered
 * without client state), and every value is bounded or `.catch()`-defaulted so
 * a hand-edited URL degrades to the safe default instead of reaching the
 * database with something unexpected.
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

export const listingsQuerySchema = z.object({
  status: z.enum(LISTINGS_STATUS_FILTERS).catch('all').default('all'),
  q: z.string().trim().max(120).catch('').default(''),
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
    ...(query.page === 1 ? {} : { page: String(query.page) }),
  };
}
