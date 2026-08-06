/**
 * Single entry point for every Drizzle table in this app. `drizzle.config.ts`
 * points Drizzle Kit here, and `src/lib/db/client.ts` passes the same barrel
 * to `drizzle()` so query results are fully typed.
 */
export * from './catalog';
