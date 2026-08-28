/**
 * The cache tag the storefront's FX buffer is stored under.
 *
 * Its own module for the same reason `catalog-tag.ts` is: `fx-buffer-cache.ts`
 * opens with `server-only` and pulls the pricing read behind it, so a server
 * action that only needs to *expire* the entry would otherwise have to import
 * the cache — and drag Drizzle into the module graph of every test that reaches
 * that action.
 *
 * `fx-buffer-cache.ts` re-exports this, so there is still exactly one
 * definition of the string. Never inline the literal at a call site: a tag
 * written twice is a tag that stops matching the day one copy is edited, and
 * the failure is silent — a shopper keeps seeing a local price built on
 * yesterday's cushion with nothing on screen saying so.
 */
// eslint-disable-next-line import/prefer-default-export -- the NAME is the point: `STOREFRONT_FX_BUFFER_TAG` reads the same at every call site, and a default export would let each importer rename it.
export const STOREFRONT_FX_BUFFER_TAG = 'storefront-fx-buffer';
