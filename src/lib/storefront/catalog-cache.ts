import 'server-only';

import { cache } from 'react';
// eslint-disable-next-line camelcase -- Next's own exported name; not ours to rename.
import { unstable_cache } from 'next/cache';
import {
  findPublishedProductBySlug,
  listCategoryDepartments,
  listPublishedCategories,
  listPublishedProducts,
  type StorefrontCategoryRow,
  type StorefrontDepartmentRow,
  type StorefrontDetailRow,
  type StorefrontPage,
  type StorefrontSection,
} from '@/modules/catalog/storefront/read-model';

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

/** Invalidated by every write that can publish, pause, or reprice a product. */
export const STOREFRONT_CATALOG_TAG = 'storefront-catalog';

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
  ['storefront-catalog-feed', 'v2'],
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
  ['storefront-catalog-product', 'v4'],
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

export const readStorefrontCategories: () => Promise<StorefrontCategoryRow[]> =
  cache(readCategoriesAcrossRequests);

export const readStorefrontDepartments: () => Promise<
  StorefrontDepartmentRow[]
> = cache(readDepartmentsAcrossRequests);
