/**
 * How many published offers one repricing run may cover.
 *
 * Its own module because both sides need the same number: `reprice.ts` enforces
 * it in a `LIMIT`, and the dialog tells the seller about it. `reprice.ts` itself
 * cannot be the shared home — it imports Drizzle and the resolver, and a client
 * component importing it would pull both into the browser bundle for one
 * integer.
 */
// eslint-disable-next-line import/prefer-default-export -- the NAME is the point: `MAX_REPRICE_OFFERS` reads the same at every call site, and a default export would let each importer rename it.
export const MAX_REPRICE_OFFERS = 500;
