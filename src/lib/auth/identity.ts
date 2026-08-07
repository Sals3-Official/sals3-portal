/**
 * The identity id of the Sals3 Official Dropshipper Account - the seller
 * account that owns the platform's own CJ supplier connection (seeded by
 * `npm run bootstrap:cj`).
 *
 * Three call sites must agree on this value: the placeholder dev session
 * (`session.ts`), the bootstrap script, and the storefront feed's headless
 * connection resolver. Before this constant existed each of them hard-coded
 * the same literal independently. When real authentication lands, the dev
 * session stops using it, but the bootstrap and the storefront resolver keep
 * needing one well-known identity for the official account.
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
