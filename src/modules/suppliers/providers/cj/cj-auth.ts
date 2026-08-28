import { CJ_BASE_URL, CjApiError } from '@/services/cj/config';
import { cjAccessTokenSchema } from '@/lib/cj/schemas';
import getDb from '@/lib/db/client';
import type { SupplierSecretStore } from '@/lib/secrets/supplier-secret-store';
import { writeWebhookSecret } from '@/lib/secrets/webhook-secret-store';
import {
  cjCredentialBundleSchema,
  type CjCredentialBundle,
} from './cj-schemas';

/**
 * Per-connection CJ token cache - the multi-tenant replacement for the
 * retired `src/services/cj/token.ts` single global cache. Each seller's own
 * connection gets its own in-memory cache entry and its own credential
 * bundle, decrypted on demand; one seller's token traffic never touches
 * another's.
 *
 * Re-authenticates via the same verified `/authentication/getAccessToken`
 * call the retired global path already used (apiKey in). Verified live
 * 2026-08-07 that this single call actually returns `openId`, `accessToken`,
 * `refreshToken`, and both expiry dates together - the real credential
 * bundle is refreshed from one call, not assembled from a separate CJ
 * "refresh" endpoint (none has been verified against the live API).
 */

const EXPIRY_MARGIN_MS = 60 * 60 * 1000;
const FALLBACK_LIFETIME_MS = 12 * 60 * 60 * 1000;
const CJ_AUTH_TIMEOUT_MS = 8_000;

type CachedToken = { token: string; expiresAtMs: number };

type ReauthResult = {
  openId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  expiresAtMs: number;
};

const cache = new Map<string, CachedToken>();

// Single-flight guard: on a cold instance the freight path fires several CJ
// calls concurrently, each asking for a token. Without this, every caller
// re-authenticated in parallel against CJ's 1-req/sec auth endpoint and the
// losers surfaced as intermittent checkout 503s.
const inFlightRefreshes = new Map<string, Promise<string>>();

function expiryToMs(expiryDate: string): number {
  const parsed = Date.parse(expiryDate);
  return Number.isNaN(parsed) ? Date.now() + FALLBACK_LIFETIME_MS : parsed;
}

function logCredentialFailure(message: string, error: unknown): void {
  // eslint-disable-next-line no-console
  console.error(message, error instanceof Error ? error.message : error);
}

function developmentApiKey(): string | undefined {
  const apiKey = process.env.CJ_API_KEY?.trim();

  if (process.env.NODE_ENV === 'production' || apiKey === undefined) {
    return undefined;
  }

  return apiKey === '' ? undefined : apiKey;
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(CJ_AUTH_TIMEOUT_MS);
}

async function reauthenticate(apiKey: string): Promise<ReauthResult> {
  let response: Response;

  try {
    response = await fetch(`${CJ_BASE_URL}/authentication/getAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
      cache: 'no-store',
      signal: timeoutSignal(),
    });
  } catch (error) {
    logCredentialFailure('[portal] CJ auth request failed', error);
    throw new CjApiError('upstream-unavailable');
  }

  if (!response.ok) {
    logCredentialFailure(
      '[portal] CJ auth failed',
      `HTTP ${response.status} ${response.statusText}`,
    );
    throw new CjApiError('upstream-unavailable');
  }

  const parsed = cjAccessTokenSchema.safeParse(await response.json());

  if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
    throw new CjApiError('authentication-failed');
  }

  const { data } = parsed.data;

  return {
    openId: String(data.openId ?? ''),
    accessToken: data.accessToken,
    accessTokenExpiresAt: data.accessTokenExpiryDate,
    refreshToken: data.refreshToken,
    refreshTokenExpiresAt: data.refreshTokenExpiryDate,
    expiresAtMs: expiryToMs(data.accessTokenExpiryDate),
  };
}

export default class CjTokenManager {
  constructor(private readonly secretStore: SupplierSecretStore) {}

  async getAccessToken(connectionId: string): Promise<string> {
    const cached = cache.get(connectionId);

    if (
      cached !== undefined &&
      cached.expiresAtMs - EXPIRY_MARGIN_MS > Date.now()
    ) {
      return cached.token;
    }

    const inFlight = inFlightRefreshes.get(connectionId);

    if (inFlight !== undefined) {
      return inFlight;
    }

    const refresh = this.loadOrRefreshToken(connectionId);
    inFlightRefreshes.set(connectionId, refresh);

    try {
      return await refresh;
    } finally {
      inFlightRefreshes.delete(connectionId);
    }
  }

  private async loadOrRefreshToken(connectionId: string): Promise<string> {
    // The pooled client, deliberately, not a caller's transaction: credential
    // reads/refresh persistence are their own units of work. A persistence
    // miss must not crash a seller page after CJ already returned a usable
    // token; the cache carries this instance until the next cold start.
    let bundle: CjCredentialBundle;

    try {
      bundle = cjCredentialBundleSchema.parse(
        await this.secretStore.read<CjCredentialBundle>(
          getDb(),
          connectionId,
          'CJ_DROPSHIPPING',
        ),
      );
    } catch (error) {
      logCredentialFailure('[portal] CJ credential read failed', error);

      const apiKey = developmentApiKey();

      if (apiKey !== undefined) {
        // Local development can point at a database whose encrypted CJ
        // credential was sealed with another machine's key. Use the explicitly
        // configured dev key for this process only; never mutate the supplier
        // credential row from a decrypt failure.
        const fresh = await reauthenticate(apiKey);

        cache.set(connectionId, {
          token: fresh.accessToken,
          expiresAtMs: fresh.expiresAtMs,
        });

        return fresh.accessToken;
      }

      throw new CjApiError('missing-credentials');
    }

    // Reuse the persisted token when it is still comfortably valid (CJ access
    // tokens live ~15 days). A cold instance must not re-authenticate against
    // CJ's 1-req/sec auth endpoint while a perfectly good token sits in the
    // credential bundle - that stampede was the intermittent checkout outage.
    const persistedExpiresAtMs = Date.parse(bundle.accessTokenExpiresAt);

    if (
      !Number.isNaN(persistedExpiresAtMs) &&
      persistedExpiresAtMs - EXPIRY_MARGIN_MS > Date.now()
    ) {
      cache.set(connectionId, {
        token: bundle.accessToken,
        expiresAtMs: persistedExpiresAtMs,
      });

      return bundle.accessToken;
    }

    const fresh = await reauthenticate(bundle.apiKey);
    cache.set(connectionId, {
      token: fresh.accessToken,
      expiresAtMs: fresh.expiresAtMs,
    });

    const updated = cjCredentialBundleSchema.parse({
      apiKey: bundle.apiKey,
      openId: fresh.openId || bundle.openId,
      accessToken: fresh.accessToken,
      accessTokenExpiresAt: fresh.accessTokenExpiresAt,
      refreshToken: fresh.refreshToken,
      refreshTokenExpiresAt: fresh.refreshTokenExpiresAt,
    });

    try {
      await this.secretStore.write(
        getDb(),
        connectionId,
        'CJ_DROPSHIPPING',
        updated,
      );
    } catch (error) {
      logCredentialFailure(
        '[portal] CJ credential refresh persistence failed',
        error,
      );
    }

    // CJ documents the account's `openId` string as the webhook HMAC-SHA256
    // secret. Persist it (encrypted) whenever a refresh observes it, so the
    // webhook endpoint can verify signatures without a live CJ call. Best
    // effort: a failure here must not fail the token refresh itself.
    if (updated.openId !== undefined && updated.openId !== '') {
      try {
        await writeWebhookSecret(getDb(), connectionId, updated.openId);
      } catch {
        // The webhook secret refreshes again on the next token renewal.
      }
    }

    return fresh.accessToken;
  }

  /** Test/ops helper: drops the cached token so the next call re-authenticates. */
  static resetCache(connectionId?: string): void {
    if (connectionId === undefined) {
      cache.clear();
      inFlightRefreshes.clear();
      return;
    }

    cache.delete(connectionId);
    inFlightRefreshes.delete(connectionId);
  }
}
