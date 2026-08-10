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
