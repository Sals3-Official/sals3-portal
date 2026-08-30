import { cache } from 'react';
// eslint-disable-next-line camelcase -- Next's own exported name; not ours to rename.
import { unstable_cache } from 'next/cache';
import { sql } from 'drizzle-orm';
import getDb from '@/lib/db/client';

/**
 * Whether this database can answer a fuzzy search.
 *
 * ## Why this is asked rather than assumed
 *
 * `pg_trgm` arrives through the `Catalog Migrate Search Trigram` break-glass
 * workflow, and there is deliberately no migration file — Drizzle cannot
 * express a GIN index on a jsonb expression, so a hand-written migration would
 * carry no matching snapshot. The consequence is that **production has the
 * extension and a fresh local database or CI does not**.
 *
 * That difference cannot be papered over, because a query calling
 * `word_similarity()` where the extension is absent does not run slowly — it
 * raises `function word_similarity(text, text) does not exist` and takes the
 * whole search down with it. So the capability is read from `pg_extension` and
 * the fuzzy arm of the predicate is only built when the answer is yes.
 *
 * ## Why it is cached for so long
 *
 * An extension appears once, by a manual break-glass run, and never disappears
 * on its own. Ten minutes of staleness after that run costs a seller nothing —
 * their search keeps working, just without typo tolerance until the window
 * turns over — while asking on every request would add a round trip to the
 * hottest screen in the Portal.
 *
 * Two layers for the reasons `status-counts-cache.ts` gives: `React.cache`
 * collapses the reads within one render, `unstable_cache` carries the answer
 * across requests. The value is a boolean, so it round-trips through
 * `JSON.stringify` exactly.
 */
async function readTrigramAvailable(): Promise<boolean> {
  const rows = (await getDb().execute(
    sql`SELECT 1 AS present FROM pg_extension WHERE extname = 'pg_trgm'`,
  )) as unknown as Array<{ present: number }>;

  return rows.length > 0;
}

const readCached = cache(async () =>
  unstable_cache(readTrigramAvailable, ['search-trigram-available'], {
    revalidate: 600,
  })(),
);

/**
 * `false` on any failure, never a throw.
 *
 * Losing typo tolerance is a smaller search; losing the search is a broken
 * screen. A database that cannot answer this question is in no state to be
 * asked a harder one, so the caller falls back to substring matching and the
 * seller still gets their results.
 */
export default async function isTrigramSearchAvailable(): Promise<boolean> {
  try {
    return await readCached();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] pg_trgm capability probe failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return false;
  }
}
