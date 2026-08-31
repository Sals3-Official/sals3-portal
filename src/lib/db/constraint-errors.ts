/**
 * Reads a Postgres unique-violation out of whatever Drizzle threw.
 *
 * This exists so a unique index can be the *enforcer* of an invariant rather
 * than a last line of defence that reports as an unknown failure. Every
 * "does this already exist?" check in a Server Action is a read-then-write
 * race; under concurrency the index is what actually holds, and without this
 * the seller sees "try again in a moment" for a permanent, explainable
 * refusal.
 *
 * Two details make the naive version silently never fire:
 *
 * - Drizzle wraps every driver error in its own error and hangs the original
 *   off `cause`, so `error.code` on the thrown object is `undefined`. The
 *   walk below is not defensive padding; it is the only reason this works.
 * - The check is duck-typed rather than `instanceof postgres.PostgresError`,
 *   which keeps the driver out of this module, survives re-wrapping, and is
 *   testable without a database.
 *
 * The returned constraint name is a database internal. Callers must map it to
 * their own reason before it reaches a client - never return it as-is.
 */

const UNIQUE_VIOLATION = '23505';

/** Depth is bounded because a `cause` chain is untrusted input like any other. */
const MAX_CAUSE_DEPTH = 5;

/**
 * The SQLSTATE Postgres actually raised, out of whatever Drizzle threw.
 *
 * The same walk as below and for the same reason, generalised past `23505` —
 * and it is not theoretical. `migrate-review-extras`'s **second** production
 * run answered `500`: its own duplicate-object check read `error.code` off the
 * wrapped error, got `undefined`, and rethrew every `42710` it exists to
 * tolerate. The idempotent re-run every break-glass migration promises only
 * holds if the code is read from here.
 *
 * `null` when nothing in the chain carries one, which a caller must treat as
 * "not a Postgres error" and rethrow rather than swallow.
 */
export function postgresErrorCode(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    if (seen.has(current)) return null;
    seen.add(current);

    const { code } = current as { code?: unknown };

    if (typeof code === 'string' && code !== '') return code;

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

/**
 * Whether Postgres refused this write for breaking a unique index.
 *
 * `uniqueViolationConstraint` below is the richer answer and is what a caller
 * with more than one index to tell apart should use. This one is for the common
 * case — a table whose single unique index *is* the invariant — where naming it
 * would only be a database internal to map straight back.
 */
export function isUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === UNIQUE_VIOLATION;
}

function readConstraintName(candidate: object): string | null {
  const { code, constraint_name: constraintName } = candidate as {
    code?: unknown;
    constraint_name?: unknown;
  };

  if (code !== UNIQUE_VIOLATION) return null;
  if (typeof constraintName !== 'string' || constraintName === '') return null;

  return constraintName;
}

export default function uniqueViolationConstraint(
  error: unknown,
): string | null {
  const seen = new Set<unknown>();
  let current = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    // A self-referencing or cyclic `cause` would otherwise spin until the
    // depth cap; stopping on repeat is both cheaper and clearer.
    if (seen.has(current)) return null;
    seen.add(current);

    const name = readConstraintName(current);

    if (name !== null) return name;

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}
