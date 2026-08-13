/**
 * The storefront API's shared response envelopes.
 *
 * One place, because the three routes must agree on two things a buyer-facing
 * API gets wrong easily: what a failure says, and what it does not say.
 *
 * The previous handlers collapsed a missing CJ credential (a configuration
 * fault), a rate limit, and an unavailable upstream into one opaque
 * `502 CJ supplier feed unavailable`, and rethrew everything else — including
 * `PermissionError` — into an unhandled 500 with a stack trace (finding 7 of
 * the 2026-08-06 portal code review). Now every unexpected failure is one
 * generic 503 to the caller and one structured line in the server log.
 */

export const STOREFRONT_HEADERS = {
  // The payload sits behind a shared bearer token, so it must never enter a
  // shared cache. Per-request caching happens server-side in `catalog-cache.ts`.
  'Cache-Control': 'private, no-store',
} as const;

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: 'Unauthorized' },
    { status: 401, headers: STOREFRONT_HEADERS },
  );
}

/**
 * The single answer for "no such slug", "not a slug", and "not published".
 * A public endpoint that distinguished them would tell an unauthenticated
 * caller which drafts exist.
 */
export function notFoundResponse(): Response {
  return Response.json(
    { error: 'Not found' },
    { status: 404, headers: STOREFRONT_HEADERS },
  );
}

/**
 * A generic, retryable failure. `503` rather than `500` because the realistic
 * causes are environmental (no `DATABASE_URL`, a connection timeout), and
 * rather than `502` because there is no upstream gateway any more.
 *
 * The error is logged, never returned: a driver message can carry a table
 * name, a column list, or a connection string fragment.
 */
export function storefrontErrorResponse(
  route: string,
  error: unknown,
): Response {
  // eslint-disable-next-line no-console
  console.error(`[storefront-api] ${route} failed`, error);

  return Response.json(
    { error: 'Catalog temporarily unavailable' },
    { status: 503, headers: STOREFRONT_HEADERS },
  );
}
