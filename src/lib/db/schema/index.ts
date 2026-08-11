/**
 * Single entry point for every Drizzle table in this app. `drizzle.config.ts`
 * points Drizzle Kit here, and `src/lib/db/client.ts` passes the same barrel
 * to `drizzle()` so query results are fully typed.
 */
export * from './catalog';
export * from './auth';
export * from './seller-accounts';
export * from './supplier-providers';
export * from './supplier-connections';
export * from './supplier-account-bindings';
export * from './supplier-secrets';
export * from './discovery';
export * from './pricing-policy';
