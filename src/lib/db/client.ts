import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Drizzle client over `postgres.js`.
 *
 * Server-only: `DATABASE_URL` has no `NEXT_PUBLIC_` prefix, and the guard
 * below turns an accidental client import into an immediate, obvious failure
 * instead of a silent bundle leak. No `server-only` package is needed for
 * that, so this adds no dependency.
 *
 * The connection is created **lazily, on first query** — never at module
 * evaluation. Next.js imports every route module during `next build`'s
 * "Collecting page data" phase, including `export const dynamic =
 * 'force-dynamic'` routes, so connecting at import time made a build fail
 * outright in any environment without `DATABASE_URL` (a Vercel preview, CI,
 * a fresh clone). Importing this module must have no side effects; only
 * running a query may require configuration.
 *
 * The client is cached on `globalThis` so Next.js's development hot-reload
 * reuses one bounded pool instead of opening a new one on every edit.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/db/client.ts is server-only and must not be imported by client code.',
  );
}

const POOL_MAX = 10;
const IDLE_TIMEOUT_SECONDS = 20;
const CONNECT_TIMEOUT_SECONDS = 10;

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * One transaction's reserved connection. Take this instead of `DbExecutor`
 * only where the pooled client would be *wrong* rather than merely different
 * — a `SELECT ... FOR UPDATE SKIP LOCKED` whose locks must survive until a
 * following `UPDATE` commits, for instance.
 */
export type DbTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

/**
 * Anything that can run a statement: the pooled client, or one transaction's
 * reserved connection. Every function that touches the database takes one of
 * these as its first argument rather than reaching for `getDb()` itself.
 *
 * That is not a style preference. `db.transaction()` reserves its own
 * `postgres.js` connection, so a statement issued through `getDb()` from
 * inside a transaction callback runs on a *different* connection and cannot
 * see the uncommitted rows around it - a foreign key to a row the
 * transaction just inserted fails outright. Passing the executor makes
 * "which connection does this run on?" a compile-time question.
 */
export type DbExecutor = Database | DbTransaction;

const globalForDb = globalThis as unknown as {
  sals3Sql?: ReturnType<typeof postgres>;
  sals3Db?: Database;
};

/**
 * Whether a connection string is present. Callers that render a page should
 * check this and degrade honestly rather than letting a query throw a 500 —
 * an environment with no database is a real, expected condition (preview
 * deploys, CI), not a bug.
 */
export function isDatabaseConfigured(): boolean {
  const connectionString = process.env.DATABASE_URL;
  return connectionString !== undefined && connectionString !== '';
}

function requiresTls(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString);
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    // An unparseable URL is a configuration error; fail closed on TLS.
    return true;
  }
}

function createSql(): ReturnType<typeof postgres> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  return postgres(connectionString, {
    max: POOL_MAX,
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    // Any non-local host must present a valid certificate.
    ssl: requiresTls(connectionString) ? 'verify-full' : false,
    // Postgres notices are diagnostics, not app events; keep logs cheap.
    onnotice: () => {},
  });
}

/**
 * Returns the Drizzle client, connecting on first use. Throws only when a
 * query is actually attempted without `DATABASE_URL`.
 */
export default function getDb(): Database {
  if (globalForDb.sals3Db !== undefined) {
    return globalForDb.sals3Db;
  }

  const sql = createSql();
  const db = drizzle(sql, { schema });

  // Cache in development so hot-reload does not leak pools. In production the
  // module itself is evaluated once per instance, so a local const suffices —
  // but caching is harmless and keeps one code path.
  globalForDb.sals3Sql = sql;
  globalForDb.sals3Db = db;

  return db;
}
