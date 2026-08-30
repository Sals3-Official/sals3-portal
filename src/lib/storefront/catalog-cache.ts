import 'server-only';

import { cache } from 'react';
// eslint-disable-next-line camelcase -- Next's own exported name; not ours to rename.
import { unstable_cache } from 'next/cache';
import {
  findPublishedProductBySlug,
  listCategoryDepartments,
  listPublishedCategories,
  listPublishedProducts,
  listPublishedProductsInDepartment,
  searchPublishedProducts,
  type StorefrontCategoryRow,
  type StorefrontDepartmentQuery,
  type StorefrontDepartmentRow,
  type StorefrontSearchQuery,
  type StorefrontDetailRow,
  type StorefrontPage,
  type StorefrontSection,
} from '@/modules/catalog/storefront/read-model';
import { STOREFRONT_CATALOG_TAG } from './catalog-tag';

/**
 * The published-catalogue reads, memoised per request and across requests.
 *
 * ## Why this replaces the old cache
 *
 * The CJ-backed feed cached in a module-level `Map` keyed by
 * `${cjPage}:${cjSearch}:${cjPid}` with lazy eviction only on a same-key hit —
 * so the `pid` component, which came from a buyer-controlled PDP URL, could
 * grow the map without bound for the lifetime of the process (finding 3 of the
 * 2026-08-06 portal code review). A tagged cache has a size policy, an
 * expiry, and an invalidation hook; a hand-rolled `Map` had none of the three.
 *
 * Two layers, solving different halves:
 *
 * - `React.cache` collapses repeated reads inside ONE request.
 * - `unstable_cache` carries the result ACROSS requests for 30 seconds, so a
 *   burst of buyers on the same page costs one query.
 *
 * ## What may travel through the boundary
 *
 * `unstable_cache` persists its value with `JSON.stringify` and forbids its
 * callback from touching request APIs (`headers()`, `cookies()`). The read
 * model touches neither, takes all inputs as arguments, and returns
 * JSON-safe values only — `publishedAt` is already an ISO string and
 * `priceMinor` is already a `number`, precisely so a `Date` does not come back
 * as a string and a `bigint` does not throw on serialisation.
 *
 * ## Callers
 *
 * Request scope only — `unstable_cache` throws outside one. Scripts and jobs
 * must call the read model directly.
 *
 * `unstable_cache` is deprecated in Next 16 in favour of `'use cache'`, which
 * needs `cacheComponents: true` — a much larger change touching every dynamic
 * page. When that lands, this module becomes `'use cache'` plus `cacheTag`/
 * `cacheLife` and nothing else moves. It matches
 * `modules/catalog/candidates/status-counts-cache.ts` on purpose: one caching
 * idiom in this repository, not three.
 */

/**
 * Invalidated by every write that can publish, pause, or reprice a product.
 *
 * Defined in `catalog-tag.ts` and re-exported here so a caller that only needs
 * to expire the cache does not have to import the cache — and with it
 * `server-only` and the whole read model. Existing importers of this name are
 * unaffected.
 */
export { STOREFRONT_CATALOG_TAG } from './catalog-tag';

/**
 * Bounds the staleness a missed `revalidateTag` can cause. Short, because the
 * price and availability a buyer sees are the two values that must not lag a
 * seller's pause by long.
 */
const REVALIDATE_SECONDS = 30;

const readFeedAcrossRequests = unstable_cache(
  async (
    section: StorefrontSection,
    page: number,
    limit: number,
  ): Promise<StorefrontPage> => listPublishedProducts({ section, page, limit }),
  // Static parts only — the arguments key the entry. The version suffix is a
  // manual bust handle for when the row shape or its semantics change.
  // Bumped to 'v2' on 2026-08-20: `primaryImageUrl` now honours
  // `show_supplier_photo` and puts seller uploads first, so a warm 'v1' card
  // could keep showing a photo the seller just hid.
  // Bumped to 'v3' on 2026-08-22: a card row now carries `rating` and its
  // `ratingLine` is derived from it, so a warm 'v2' entry would keep serving
  // "No reviews yet" over a product that has been reviewed.
  ['storefront-catalog-feed', 'v3'],
  { revalidate: REVALIDATE_SECONDS, tags: [STOREFRONT_CATALOG_TAG] },
);

const readProductAcrossRequests = unstable_cache(
  async (slug: string): Promise<StorefrontDetailRow | null> =>
    findPublishedProductBySlug(slug),
  // Bumped to 'v2' on 2026-08-15: `StorefrontVariant` gained `label`. Without the
  // bump, entries cached under 'v1' keep serving label-less variants for up to
  // REVALIDATE_SECONDS after deploy, which reads as "the feature did not ship".
  // Bumped to 'v3' on 2026-08-20: `images` now honours `show_supplier_photo`
  // and orders seller uploads first. Categories stay on 'v1' — their row shape
  // is unchanged, and busting them would discard warm entries for nothing.
  // Bumped to 'v4' on 2026-08-21: the detail row gained `specification` and
  // `metaDescription`. The feed key is deliberately left on 'v2' — a card row
  // carries neither field, so busting it would discard warm entries for
  // nothing.
  // Bumped to 'v5' on 2026-08-22: the detail row gained `rating` and
  // `ratingBreakdown`.
  // Bumped to 'v6' on 2026-08-24: each variant gained `imageUrl`. The feed key
  // stays on 'v2' — a card row has no variants, so busting it would discard
  // warm entries for nothing.
  // Bumped to 'v7' on 2026-08-31: the detail row gained `categoryTrail`, so a
  // warm 'v6' entry keeps serving a PDP whose breadcrumb cannot link past the
  // department — which reads as "the feature did not ship". The feed key stays
  // on 'v3': a card row has no breadcrumb.
  ['storefront-catalog-product', 'v7'],
  { revalidate: REVALIDATE_SECONDS, tags: [STOREFRONT_CATALOG_TAG] },
);

/**
 * The department browse, keyed by every input that changes its rows.
 *
 * Its own key rather than a share of `storefront-catalog-feed`: the two answer
 * different questions over the same table, and one filtered department page
 * must never be served for another. Starts at 'v1' — there is no earlier
 * shape to bust. The feed and product keys are deliberately untouched: a card
 * row's shape has not changed, so busting them would discard warm entries for
 * nothing.
 *
 * The arguments are spread rather than passed as the query object because
 * `unstable_cache` keys on the serialised argument list, and an object literal
 * would key on property order as well as value.
 */
const readDepartmentFeedAcrossRequests = unstable_cache(
  async (
    /**
     * Exactly one of these is set, and the route decides which.
     *
     * Two positional arguments rather than one scope object for the reason the
     * note above gives: `unstable_cache` keys on the serialised argument list, so
     * an object would key on property order as well as value. `null` for the
     * unused half keeps both positions present in every key.
     */
    departmentName: string | null,
    categoryPath: string | null,
    sort: StorefrontDepartmentQuery['sort'],
    page: number,
    limit: number,
    minPriceMinor: number | undefined,
    maxPriceMinor: number | undefined,
  ): Promise<StorefrontPage> =>
    listPublishedProductsInDepartment({
      ...(categoryPath === null
        ? { departmentName: departmentName ?? '' }
        : { categoryPath }),
      sort,
      page,
      limit,
      minPriceMinor,
      maxPriceMinor,
    }),
  // 'v2': the argument list gained a scope, so entries keyed on the old arity
  // must not be reused.
  ['storefront-catalog-department-feed', 'v2'],
  { revalidate: REVALIDATE_SECONDS, tags: [STOREFRONT_CATALOG_TAG] },
);

/**
 * Search, on its own key.
 *
 * Cached like everything else here, but the hit rate is expected to be poor and
 * that is fine: the point is that a burst of buyers typing the *same* term
 * costs one query, not that arbitrary terms are cheap. `REVALIDATE_SECONDS`
 * bounds how long a term can serve a product that has since been paused.
 *
 * The term is part of the key, so entries are per-term. Starts at 'v1'.
 */
const readSearchAcrossRequests = unstable_cache(
  async (
    term: string,
    departmentName: string | undefined,
    sort: StorefrontSearchQuery['sort'],
    page: number,
    limit: number,
    minPriceMinor: number | undefined,
    maxPriceMinor: number | undefined,
  ): Promise<StorefrontPage> =>
    searchPublishedProducts({
      term,
      departmentName,
      sort,
      page,
      limit,
      minPriceMinor,
      maxPriceMinor,
    }),
  ['storefront-catalog-search', 'v1'],
  { revalidate: REVALIDATE_SECONDS, tags: [STOREFRONT_CATALOG_TAG] },
);

const readCategoriesAcrossRequests = unstable_cache(
  async (): Promise<StorefrontCategoryRow[]> => listPublishedCategories(),
  ['storefront-catalog-categories', 'v1'],
  { revalidate: REVALIDATE_SECONDS, tags: [STOREFRONT_CATALOG_TAG] },
);

/**
 * Cached separately from the published-category list, and on a longer-lived
 * key in spirit: the department list only changes when the taxonomy itself is
 * reseeded, not when a product is published. It still shares the catalogue tag
 * so one revalidation clears both.
 */
const readDepartmentsAcrossRequests = unstable_cache(
  async (): Promise<StorefrontDepartmentRow[]> => listCategoryDepartments(),
  ['storefront-catalog-departments', 'v1'],
  { revalidate: REVALIDATE_SECONDS, tags: [STOREFRONT_CATALOG_TAG] },
);

export const readStorefrontFeed: (
  section: StorefrontSection,
  page: number,
  limit: number,
) => Promise<StorefrontPage> = cache(readFeedAcrossRequests);

export const readStorefrontProduct: (
  slug: string,
) => Promise<StorefrontDetailRow | null> = cache(readProductAcrossRequests);

export const readStorefrontDepartmentFeed: (
  departmentName: string | null,
  categoryPath: string | null,
  sort: StorefrontDepartmentQuery['sort'],
  page: number,
  limit: number,
  minPriceMinor: number | undefined,
  maxPriceMinor: number | undefined,
) => Promise<StorefrontPage> = cache(readDepartmentFeedAcrossRequests);

export const readStorefrontSearch: (
  term: string,
  departmentName: string | undefined,
  sort: StorefrontSearchQuery['sort'],
  page: number,
  limit: number,
  minPriceMinor: number | undefined,
  maxPriceMinor: number | undefined,
) => Promise<StorefrontPage> = cache(readSearchAcrossRequests);

export const readStorefrontCategories: () => Promise<StorefrontCategoryRow[]> =
  cache(readCategoriesAcrossRequests);

export const readStorefrontDepartments: () => Promise<
  StorefrontDepartmentRow[]
> = cache(readDepartmentsAcrossRequests);
