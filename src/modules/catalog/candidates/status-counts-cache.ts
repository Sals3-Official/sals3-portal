import { cache } from 'react';
// eslint-disable-next-line camelcase -- Next's own exported name; not ours to rename.
import { unstable_cache } from 'next/cache';
import {
  countCandidateStatusSummary,
  type CandidateStatusCounts,
} from './queries';

/**
 * The candidate status summary, read at most once per request and at most once
 * per 30 seconds.
 *
 * ## Why
 *
 * Measured on one render of `/products/pipeline`: `countCandidateStatusSummary`
 * ran TWICE - once for the nav rail's badges in `(portal)/layout.tsx`, once for
 * the tab bar in `pipeline-page-data.ts` - and it is three statements each time.
 * Six scans for one identical answer, on every navigation, including every
 * drawer open and every drawer close. With one seller account the
 * `sellerAccountId` filter narrows nothing, so each scan reads the whole table.
 *
 * Two layers, because they solve different halves:
 *
 * - `React.cache` collapses the layout's call and the page's call within ONE
 *   request. This is what removes the duplication.
 * - `unstable_cache` carries the result ACROSS requests for 30 seconds, so an
 *   open-then-close cycle - seconds apart - counts nothing at all.
 *
 * ## Why the request-scoped value can travel through the boundary
 *
 * `unstable_cache` forbids its callback from touching uncached request APIs
 * (`headers()`, `cookies()`). `countCandidateStatusSummary` touches neither: it
 * takes `sellerAccountId` as an argument and uses only the database. So the
 * seller id passes in as an argument, which is exactly what the Next docs
 * prescribe, and no new boundary is needed above auth resolution.
 *
 * Tenancy is structural, not a convention: the cache key includes
 * `JSON.stringify(args)`, so `sellerAccountId` is part of the key and one seller
 * can never be served another's counts.
 *
 * ## What must NEVER be cached this way
 *
 * The cached value is persisted with `JSON.stringify`. `CandidateStatusCounts`
 * is all numbers, so it round-trips exactly. `resolveCandidateDetail` must not
 * come here: it returns `Date` fields that would come back as ISO strings and
 * break `formatUtcDateTime` at runtime while the typecheck stayed green.
 *
 * ## Callers
 *
 * Request scope only - a render, a route handler, or a server action.
 * `unstable_cache` throws outside one, so scripts and the evaluator must keep
 * calling `countCandidateStatusSummary` directly.
 *
 * `unstable_cache` is deprecated in Next 16 in favour of `'use cache'`, which
 * needs `cacheComponents: true` - a much larger change touching every dynamic
 * page. When that lands, this module becomes `'use cache'` plus `cacheTag`/
 * `cacheLife` and nothing else has to move.
 */

/** Invalidated by every write that can move a candidate between buckets. */
export const CANDIDATE_STATUS_COUNTS_TAG = 'candidate-status-counts';

/**
 * Bounds the staleness a missed `revalidateTag` can cause. Deliberately short:
 * the same counts also feed the pipeline's `total`, so a stale value can label a
 * tab 412 above 413 rows and, on a page boundary, clamp a seller back one page.
 * Both self-heal; 30 seconds is how long they can last.
 */
const REVALIDATE_SECONDS = 30;

const readAcrossRequests = unstable_cache(
  countCandidateStatusSummary,
  // Static parts only. `sellerAccountId` keys the entry via the arguments;
  // 'v1' is a manual bust handle for when the result shape changes.
  ['candidate-status-counts', 'v1'],
  { revalidate: REVALIDATE_SECONDS, tags: [CANDIDATE_STATUS_COUNTS_TAG] },
);

const readCandidateStatusCounts: (
  sellerAccountId: string,
) => Promise<CandidateStatusCounts> = cache(readAcrossRequests);

export default readCandidateStatusCounts;
