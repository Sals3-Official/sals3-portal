import { CJ_BASE_URL, CjApiError } from '@/services/cj/config';
import { cjAccessTokenSchema } from '@/lib/cj/schemas';
import type { SupplierSecretStore } from '@/lib/secrets/supplier-secret-store';
import {
  cjCredentialBundleSchema,
  type CjCredentialBundle,
} from './cj-schemas';

/**
 * Per-connection CJ token cache - the multi-tenant replacement for
 * `src/services/cj/token.ts`'s single global cache. Each seller's own
 * connection gets its own in-memory cache entry and its own credential
 * bundle, decrypted on demand; one seller's token traffic never touches
 * another's.
 *
 * Re-authenticates via the same verified `/authentication/getAccessToken`
 * call `services/cj/token.ts` already uses (apiKey in). Verified live
 * 2026-08-07 that this single call actually returns `openId`, `accessToken`,
 * `refreshToken`, and both expiry dates together - the real credential
 * bundle is refreshed from one call, not assembled from a separate CJ
 * "refresh" endpoint (none has been verified against the live API).
 */

const EXPIRY_MARGIN_MS = 60 * 60 * 1000;
const FALLBACK_LIFETIME_MS = 12 * 60 * 60 * 1000;

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

function expiryToMs(expiryDate: string): number {
  const parsed = Date.parse(expiryDate);
  return Number.isNaN(parsed) ? Date.now() + FALLBACK_LIFETIME_MS : parsed;
}

async function reauthenticate(apiKey: string): Promise<ReauthResult> {
  const response = await fetch(`${CJ_BASE_URL}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
    cache: 'no-store',
  });

  if (!response.ok) {
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

    const bundle = await this.secretStore.read<CjCredentialBundle>(
      connectionId,
      'CJ_DROPSHIPPING',
    );

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

    await this.secretStore.write(connectionId, 'CJ_DROPSHIPPING', updated);

    return fresh.accessToken;
  }

  /** Test/ops helper: drops the cached token so the next call re-authenticates. */
  static resetCache(connectionId?: string): void {
    if (connectionId === undefined) {
      cache.clear();
      return;
    }

    cache.delete(connectionId);
  }
}
