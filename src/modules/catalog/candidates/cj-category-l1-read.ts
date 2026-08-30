import { cache } from 'react';
// eslint-disable-next-line camelcase -- Next's own exported name; not ours to rename.
import { unstable_cache } from 'next/cache';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import { discoveryCycles, supplierConnections } from '@/lib/db/schema';
import {
  EMPTY_CJ_CATEGORY_INDEX,
  indexCategorySnapshot,
  type CjCategoryIndex,
} from './cj-category-l1';

/**
 * The database half of the CJ Level 1 lookup.
 *
 * Split from `cj-category-l1.ts` so the pure indexing logic can be imported by
 * anything — including a component test — without dragging `@/lib/db/client`
 * into that module graph, where its own server-only guard throws at import
 * time. Same reason `price-by-destination-actions.ts` defers its domain
 * imports into the call.
 */

async function readLatestSnapshot(
  sellerAccountId: string,
): Promise<CjCategoryIndex> {
  const rows = await getDb()
    .select({ snapshot: discoveryCycles.categorySnapshot })
    .from(discoveryCycles)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, discoveryCycles.supplierConnectionId),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        isNotNull(discoveryCycles.categorySnapshot),
      ),
    )
    .orderBy(desc(discoveryCycles.startedAt))
    .limit(1);

  return indexCategorySnapshot(rows[0]?.snapshot);
}

/**
 * Two layers, for the same reasons `status-counts-cache.ts` carries them:
 * `React.cache` collapses the several reads one render makes (the table, the
 * filter bar's option list, the applied-filter resolution) into one, and
 * `unstable_cache` carries the answer across requests. The window is long
 * because the value only changes when a discovery cycle starts, which is hours
 * apart — not seconds.
 *
 * The cached value is persisted with `JSON.stringify`, and this one is strings
 * and arrays of strings throughout, so it round-trips exactly. Tenancy is
 * structural: `sellerAccountId` is an argument, so it is part of the cache key.
 */
const readIndex = cache(async (sellerAccountId: string) =>
  unstable_cache(readLatestSnapshot, ['cj-category-l1'], {
    revalidate: 900,
  })(sellerAccountId),
);

/**
 * The CJ Level 1 index for this seller, or the empty index when no cycle has
 * recorded a snapshot yet. Never throws: a category label is decoration on a
 * row, and losing it must not cost the seller their pipeline.
 */
export default async function readCjCategoryIndex(
  sellerAccountId: string,
): Promise<CjCategoryIndex> {
  try {
    return await readIndex(sellerAccountId);
  } catch (error) {
    console.error('[cj-category-l1] snapshot read failed', error);

    return EMPTY_CJ_CATEGORY_INDEX;
  }
}
