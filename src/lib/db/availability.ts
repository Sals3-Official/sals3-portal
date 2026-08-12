/**
 * Tells "the database cannot be reached" apart from every other thrown error.
 *
 * `isDatabaseConfigured()` answers a narrower question than its callers have
 * always assumed: it checks that `DATABASE_URL` is a non-empty string, nothing
 * more. A URL pointing at a stopped server, a dropped database, or an
 * unroutable host sails straight past it, and the first query then throws deep
 * inside a Server Component - which is how a local Postgres losing its `sals3`
 * database turned every seller page into a red `read ECONNRESET` overlay while
 * the guard above it reported everything fine.
 *
 * The classification is deliberately narrow. Only genuine unavailability
 * belongs here, because a page that renders "cannot reach the database" for a
 * fault that is really something else has converted a loud bug into a quiet
 * lie - the exact failure mode this module exists to prevent.
 *
 * Explicitly NOT unavailability, and left to throw:
 *
 * - `42P01 undefined_table` - the database answered; a table is missing, which
 *   means migrations have not been applied. Rendering an empty page here would
 *   hide an unmigrated deployment behind a state that looks deliberate. This
 *   repository currently carries several generated-but-unapplied migrations,
 *   so that is a live risk, not a hypothetical one.
 * - `28P01`/`28000` authentication failures - a credential is wrong. That is a
 *   configuration defect someone must see and fix, not a transient condition.
 * - `PermissionError` and every other application error - authorization
 *   decisions must never be softened by an infrastructure guard.
 *
 * Error shapes are duck-typed and the `cause` chain is walked for the same
 * reason `constraint-errors.ts` does it: Drizzle wraps every driver error in
 * its own, so `error.code` on the thrown object is `undefined`. That walk is
 * not defensive padding - without it this returns `false` for every real
 * failure.
 */

/** Depth is bounded because a `cause` chain is untrusted input like any other. */
const MAX_CAUSE_DEPTH = 5;

/**
 * Node socket-level failures. These are what a stopped server, a wrong port,
 * or a dropped connection actually surface as.
 */
const SOCKET_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EAI_AGAIN',
]);

/**
 * Postgres SQLSTATE codes that mean the server refused or dropped the
 * session rather than answering a query.
 *
 * Class `08` is the standard connection-exception class. `3D000` is included
 * on purpose: a `DATABASE_URL` naming a database that does not exist is an
 * environment that was never set up, which is precisely the honest
 * "not available here" case rather than a code defect.
 */
const POSTGRES_UNAVAILABLE_CODES = new Set([
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
  '08P01', // protocol_violation
  '3D000', // invalid_catalog_name - the database itself is gone
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now - server still starting up
]);

/** `postgres.js` raises these with a string `code` of its own, not a SQLSTATE. */
const DRIVER_ERROR_CODES = new Set([
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECTION_CONNECT_TIMEOUT',
  'CONNECT_TIMEOUT',
]);

function matchesUnavailableCode(candidate: object): boolean {
  const { code } = candidate as { code?: unknown };

  if (typeof code !== 'string') return false;

  return (
    SOCKET_ERROR_CODES.has(code) ||
    POSTGRES_UNAVAILABLE_CODES.has(code) ||
    DRIVER_ERROR_CODES.has(code)
  );
}

/**
 * Whether this error means the database could not be reached at all.
 *
 * Returns `false` for anything it does not positively recognise, so an
 * unfamiliar failure keeps its stack trace and reaches the developer instead
 * of being absorbed into a tidy empty state.
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    // A self-referencing or cyclic `cause` would otherwise spin until the
    // depth cap; stopping on repeat is both cheaper and clearer.
    if (seen.has(current)) return false;
    seen.add(current);

    if (matchesUnavailableCode(current)) return true;

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

export type DatabaseReadResult<T> =
  { ok: true; data: T } | { ok: false; reason: 'DATABASE_UNAVAILABLE' };

/**
 * One outage produces one log line per surface per minute, not one per read.
 *
 * An unreachable database fails *every* read, so a single page load was
 * emitting the same line five times - once for the nav shell and once for each
 * concurrent query. That is the noise rule 53 in the code rules warns about
 * ("do not log repeated events"), and it is worse in production, where a short
 * outage would otherwise flood the log with thousands of identical lines and
 * bury whatever else was happening.
 */
const LOG_INTERVAL_MS = 60_000;
/** Bounded because labels are developer-authored, but the map is long-lived. */
const MAX_TRACKED_LABELS = 100;
const lastLoggedAt = new Map<string, number>();

function shouldLog(label: string, now: number): boolean {
  const previous = lastLoggedAt.get(label);

  if (previous !== undefined && now - previous < LOG_INTERVAL_MS) return false;

  if (lastLoggedAt.size >= MAX_TRACKED_LABELS && !lastLoggedAt.has(label)) {
    lastLoggedAt.clear();
  }

  lastLoggedAt.set(label, now);

  return true;
}

/**
 * Runs a database read and converts *only* unavailability into a value the
 * caller can render. Everything else rethrows with its stack intact.
 *
 * `label` identifies the call site in the server log. It is the only thing
 * written alongside the driver's own message - no connection string, no
 * credential, no query parameters, since those routinely carry a password or
 * a tenant identifier.
 *
 * Wrap the authorization call together with the reads it guards. Resolving the
 * seller account is itself a query, so leaving it outside means the page still
 * crashes before reaching the part that was carefully protected - which is
 * exactly what happened to `SupplierProductsWorkspace`.
 *
 * Logged at `warn`, not `error`, and the distinction is deliberate rather than
 * cosmetic. This path is a *handled* condition: the caller renders an explicit
 * "cannot reach the database" state, so the operator already has a visible
 * signal. Reserving `error` for genuinely unhandled faults is what keeps the
 * Next dev overlay meaningful - a red overlay on a page that recovered
 * correctly teaches a developer to dismiss the overlay, which is precisely
 * when it stops protecting them. `warn` is still captured by Vercel's logs and
 * by any alert threshold set at warning or above.
 */
export async function readOrUnavailable<T>(
  label: string,
  read: () => Promise<T>,
): Promise<DatabaseReadResult<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    if (!isDatabaseUnavailableError(error)) throw error;

    if (shouldLog(label, Date.now())) {
      // eslint-disable-next-line no-console
      console.warn(
        `[portal] database unavailable during ${label}`,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }

    return { ok: false, reason: 'DATABASE_UNAVAILABLE' };
  }
}

/** Test seam: the throttle is module state, so a suite must be able to reset it. */
export function resetUnavailableLogThrottle(): void {
  lastLoggedAt.clear();
}
