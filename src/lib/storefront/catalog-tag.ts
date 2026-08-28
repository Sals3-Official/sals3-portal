/**
 * The cache tag every buyer-facing catalogue read is stored under.
 *
 * Its own module, holding one string, for one reason: `catalog-cache.ts` opens
 * with `server-only` and pulls the whole storefront read model in behind it, so
 * anything that merely needs to *expire* the cache used to have to import the
 * cache itself. A server action that reprices an offer needs the tag and
 * nothing else — and a client component that imports that action must not drag
 * Drizzle and the read model into its module graph to get it.
 *
 * `catalog-cache.ts` re-exports this, so every existing importer keeps working
 * and there is still exactly one definition of the string. Never inline the
 * literal at a call site: a tag that is written twice is a tag that stops
 * matching the day one of them is edited, and the failure is silent — a buyer
 * keeps seeing yesterday's price with nothing on screen saying so.
 */
// eslint-disable-next-line import/prefer-default-export -- the NAME is the point: `STOREFRONT_CATALOG_TAG` reads the same at every call site, and a default export would let each importer rename it.
export const STOREFRONT_CATALOG_TAG = 'storefront-catalog';
