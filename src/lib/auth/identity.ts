/**
 * The identity id of the Sals3 Official Dropshipper Account - the seller
 * account that owns the platform's own CJ supplier connection (seeded by
 * `npm run bootstrap:cj`).
 *
 * Two call sites must agree on this value: the placeholder dev session
 * (`session.ts`) and the bootstrap script. Before this constant existed each
 * of them hard-coded the same literal independently.
 *
 * **No request path reads this any more.** The storefront feed used to resolve
 * a headless CJ connection through it, which is exactly how the public
 * storefront went down: the `dev-user` connection was purged, the lookup
 * returned null, and every buyer request answered
 * `502 CJ supplier feed unavailable`. The storefront now reads the published
 * catalogue from the database (owner decision 2026-08-13), so a well-known
 * bootstrap identity is no longer load-bearing for buyers — and must not
 * become so again.
 *
 * Keep this module free of imports: the bootstrap script loads it through
 * tsx outside the Next.js module graph.
 *
 * Named export, not the default this rule would prefer: under the bootstrap
 * script's tsx/esbuild CJS interop a default export arrived as a module
 * namespace object, which stringified to "[object Object]" and seeded a
 * bogus seller account row. A named export survives that interop.
 */
// eslint-disable-next-line import/prefer-default-export
export const SALS3_OFFICIAL_IDENTITY_ID = 'dev-user';
