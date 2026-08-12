// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

type CacheOptions = { revalidate: number; tags: string[] };

/**
 * The signature is declared on the generic so `mock.calls[0]` destructures
 * without a cast, while the implementation only needs its first argument. The
 * mock returns the function untouched, so importing the module under test does
 * not build a real cache.
 */
const unstableCache = vi.hoisted(() =>
  vi.fn<(fn: unknown, keyParts: string[], options: CacheOptions) => unknown>(
    (fn) => fn,
  ),
);

vi.mock('next/cache', () => ({ unstable_cache: unstableCache }));

/* eslint-disable import/first */
import { CANDIDATE_STATUS_COUNTS_TAG } from './status-counts-cache';
/* eslint-enable import/first */

/**
 * The cache boundary's configuration, asserted rather than assumed.
 *
 * The TTL is the bound on how long a missed `revalidateTag` can show a seller a
 * stale badge - and because the same counts feed the pipeline's `total`, a stale
 * value can also label a tab 412 above 413 rows and clamp a seller back a page.
 * Raising it silently would widen both, so it is pinned here.
 *
 * The tag is what the queue consumer, the break-glass tick, and the recheck
 * action all invalidate; a rename on one side only would break invalidation
 * without breaking anything a typecheck can see.
 */
describe('status counts cache boundary', () => {
  it('is tagged and bounded at 30 seconds', () => {
    expect(unstableCache).toHaveBeenCalledTimes(1);

    const [, keyParts, options] = unstableCache.mock.calls[0];

    expect(options.tags).toEqual([CANDIDATE_STATUS_COUNTS_TAG]);
    expect(options.revalidate).toBe(30);
    // Static key parts only: the seller id keys the entry through the arguments,
    // which is what makes tenant isolation structural rather than a convention.
    expect(keyParts).toEqual(['candidate-status-counts', 'v1']);
  });

  it('exports the tag the write paths invalidate', () => {
    expect(CANDIDATE_STATUS_COUNTS_TAG).toBe('candidate-status-counts');
  });
});
