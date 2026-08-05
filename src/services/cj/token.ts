import { cjAccessTokenSchema } from '@/lib/cj/schemas';
import { CJ_BASE_URL, CjApiError } from './config';

/**
 * CJ access-token handling.
 *
 * The API key is read from `process.env.CJ_API_KEY` on the server only. It has
 * no `NEXT_PUBLIC_` prefix, so it is never part of the browser bundle, and it is
 * never returned to the client or written to a log.
 *
 * CJ limits every endpoint to one call per second and returns the same token for
 * repeated requests inside 24 hours, so a token is fetched once and kept in
 * memory until shortly before it expires. Concurrent callers share one in-flight
 * request rather than each firing their own, which would trip the rate limit.
 */

type CachedToken = {
  token: string;
  expiresAtMs: number;
};

type TokenState = {
  cached: CachedToken | null;
  inFlight: Promise<string> | null;
};

const STATE_KEY = Symbol.for('sals3.portal.cjToken');

type GlobalWithState = typeof globalThis & { [STATE_KEY]?: TokenState };

/** Refresh this long before the stated expiry, so a call never uses a dead token. */
const EXPIRY_MARGIN_MS = 60 * 60 * 1000;

/** Fallback lifetime when CJ sends an expiry date we cannot read. */
const FALLBACK_LIFETIME_MS = 12 * 60 * 60 * 1000;

function state(): TokenState {
  const scope = globalThis as GlobalWithState;

  scope[STATE_KEY] ??= { cached: null, inFlight: null };

  return scope[STATE_KEY];
}

function readApiKey(): string {
  const apiKey = process.env.CJ_API_KEY;

  if (apiKey === undefined || apiKey.trim() === '') {
    throw new CjApiError('missing-credentials');
  }

  return apiKey.trim();
}

function expiryToMs(expiryDate: string): number {
  const parsed = Date.parse(expiryDate);

  if (Number.isNaN(parsed)) {
    return Date.now() + FALLBACK_LIFETIME_MS;
  }

  return parsed;
}

async function requestToken(): Promise<string> {
  const response = await fetch(`${CJ_BASE_URL}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: readApiKey() }),
    // A credential exchange must never be stored in a shared cache.
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new CjApiError('upstream-unavailable');
  }

  const parsed = cjAccessTokenSchema.safeParse(await response.json());

  if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
    throw new CjApiError('authentication-failed');
  }

  const { accessToken, accessTokenExpiryDate } = parsed.data.data;

  state().cached = {
    token: accessToken,
    expiresAtMs: expiryToMs(accessTokenExpiryDate),
  };

  return accessToken;
}

/** Returns a usable access token, from memory when one is still valid. */
export async function getCjAccessToken(): Promise<string> {
  const current = state();
  const { cached } = current;

  if (cached !== null && cached.expiresAtMs - EXPIRY_MARGIN_MS > Date.now()) {
    return cached.token;
  }

  current.inFlight ??= requestToken().finally(() => {
    state().inFlight = null;
  });

  return current.inFlight;
}

/** Test helper: drops the cached token so the next call fetches a new one. */
export function resetCjToken(): void {
  (globalThis as GlobalWithState)[STATE_KEY] = { cached: null, inFlight: null };
}
