import 'server-only';

import { cache } from 'react';
// eslint-disable-next-line camelcase -- Next's own exported name; not ours to rename.
import { unstable_cache } from 'next/cache';
import getDb from '@/lib/db/client';
import resolveStorefrontFxBuffer, {
  type StorefrontFxBufferResult,
} from '@/modules/pricing/storefront-fx-buffer';
import { STOREFRONT_FX_BUFFER_TAG } from './fx-buffer-tag';

/**
 * The FX buffer read, memoised per request and across requests.
 *
 * Same two layers and the same idiom as `catalog-cache.ts`, for the same
 * reasons — one caching pattern in this repository, not three:
 *
 * - `React.cache` collapses repeated reads inside ONE request.
 * - `unstable_cache` carries the result ACROSS requests, so a burst of
 *   storefront renders costs one query rather than one each.
 *
 * ## What may travel through the boundary
 *
 * `unstable_cache` persists its value with `JSON.stringify` and forbids its
 * callback from touching request APIs. `resolveStorefrontFxBuffer` takes its
 * executor as an argument, touches neither `headers()` nor `cookies()`, and
 * returns plain numbers and strings — no `Date`, no `bigint`, nothing that
 * changes shape on the way back out.
 *
 * `now` is deliberately NOT passed through this boundary. It would become part
 * of the cache key and every call would miss; expiry is handled by
 * `REVALIDATE_SECONDS` bounding how long a lapsed policy can still be served.
 */

/**
 * Invalidated by every write that can change or deactivate the buffer.
 *
 * Defined in `fx-buffer-tag.ts` and re-exported here so a caller that only
 * needs to expire the entry never has to import this module and the
 * `server-only` read behind it. Mirrors how `catalog-cache.ts` re-exports
 * `STOREFRONT_CATALOG_TAG`.
 */
export { STOREFRONT_FX_BUFFER_TAG } from './fx-buffer-tag';

/**
 * Bounds the staleness a missed `updateTag` can cause, and the window in which
 * a policy that reached its `effectiveTo` can still be served.
 *
 * Sixty seconds rather than the catalogue's thirty: this value changes when a
 * human edits one field on one screen, not on every publish. The storefront
 * caches the response for an hour on top of this, so the number a shopper sees
 * is governed by that, not by this — what this bounds is database load.
 */
const REVALIDATE_SECONDS = 60;

const readFxBufferAcrossRequests = unstable_cache(
  async (): Promise<StorefrontFxBufferResult> =>
    resolveStorefrontFxBuffer(getDb()),
  // Starts at 'v1' — there is no earlier shape to bust. Bump it if the result
  // shape or its meaning changes, or a warm entry will keep serving the old
  // one for up to REVALIDATE_SECONDS after deploy, which reads as "the feature
  // did not ship".
  ['storefront-fx-buffer', 'v1'],
  { revalidate: REVALIDATE_SECONDS, tags: [STOREFRONT_FX_BUFFER_TAG] },
);

/** Request scope only — `unstable_cache` throws outside one. */
const readStorefrontFxBuffer = cache(
  async (): Promise<StorefrontFxBufferResult> => readFxBufferAcrossRequests(),
);

export default readStorefrontFxBuffer;
