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
 * The connection is cached on `globalThis` in development so Next.js's
 * module hot-reload reuses one bounded pool instead of opening a new one on
 * every edit.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/db/client.ts is server-only and must not be imported by client code.',
  );
}

const POOL_MAX = 10;
const IDLE_TIMEOUT_SECONDS = 20;
const CONNECT_TIMEOUT_SECONDS = 10;

type DbClient = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  sals3Sql?: ReturnType<typeof postgres>;
  sals3Db?: DbClient;
};

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

const sql = globalForDb.sals3Sql ?? createSql();
const db: DbClient = globalForDb.sals3Db ?? drizzle(sql, { schema });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.sals3Sql = sql;
  globalForDb.sals3Db = db;
}

export { sql };
export default db;
