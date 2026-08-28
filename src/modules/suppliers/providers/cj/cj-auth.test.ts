import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplierSecretStore } from '@/lib/secrets/supplier-secret-store';
import { CjApiError } from '@/services/cj/config';
import CjTokenManager from './cj-auth';

const { getDbMock, writeWebhookSecretMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(() => ({})),
  writeWebhookSecretMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  default: getDbMock,
}));

vi.mock('@/lib/secrets/webhook-secret-store', () => ({
  writeWebhookSecret: writeWebhookSecretMock,
}));

const credentialBundle = {
  apiKey: 'cj-api-key',
  openId: 'open-1',
  accessToken: 'old-access-token',
  accessTokenExpiresAt: '2026-08-11T00:00:00.000Z',
  refreshToken: 'old-refresh-token',
  refreshTokenExpiresAt: '2027-08-11T00:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function accessTokenResponse() {
  return jsonResponse({
    code: 200,
    message: 'ok',
    data: {
      openId: 12345,
      accessToken: 'fresh-access-token',
      accessTokenExpiryDate: '2027-02-06T03:53:41.000Z',
      refreshToken: 'fresh-refresh-token',
      refreshTokenExpiryDate: '2027-08-06T03:53:41.000Z',
    },
  });
}

function secretStore(
  overrides: Partial<SupplierSecretStore> = {},
): SupplierSecretStore {
  return {
    read: vi.fn().mockResolvedValue(credentialBundle),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('CjTokenManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    CjTokenManager.resetCache();
    delete process.env.CJ_API_KEY;
    getDbMock.mockClear();
    writeWebhookSecretMock.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accessTokenResponse()));
  });

  it('maps credential read failures to missing credentials', async () => {
    const manager = new CjTokenManager(
      secretStore({
        read: vi.fn().mockRejectedValue(new Error('bad decrypt')),
      }),
    );

    await expect(manager.getAccessToken('connection-1')).rejects.toMatchObject({
      reason: 'missing-credentials',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the configured CJ_API_KEY only as a non-production fallback when local decryption fails', async () => {
    process.env.CJ_API_KEY = 'dev-cj-api-key';
    const store = secretStore({
      read: vi.fn().mockRejectedValue(new Error('bad decrypt')),
      write: vi.fn().mockResolvedValue(undefined),
    });
    const manager = new CjTokenManager(store);

    await expect(manager.getAccessToken('connection-1')).resolves.toBe(
      'fresh-access-token',
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/authentication/getAccessToken'),
      expect.objectContaining({
        body: JSON.stringify({ apiKey: 'dev-cj-api-key' }),
      }),
    );
    expect(store.write).not.toHaveBeenCalled();
  });

  it('maps malformed stored credentials to missing credentials', async () => {
    const manager = new CjTokenManager(
      secretStore({
        read: vi.fn().mockResolvedValue({ apiKey: '' }),
      }),
    );

    await expect(manager.getAccessToken('connection-1')).rejects.toMatchObject({
      reason: 'missing-credentials',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a fresh token even when refreshed credential persistence fails', async () => {
    const store = secretStore({
      write: vi.fn().mockRejectedValue(new Error('write failed')),
    });
    const manager = new CjTokenManager(store);

    await expect(manager.getAccessToken('connection-1')).resolves.toBe(
      'fresh-access-token',
    );
    expect(store.write).toHaveBeenCalledOnce();
    expect(writeWebhookSecretMock).toHaveBeenCalledWith(
      expect.anything(),
      'connection-1',
      '12345',
    );
  });

  it('preserves CJ authentication failures as structured CJ API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse({ code: 401, message: 'bad' })),
        ),
    );
    const manager = new CjTokenManager(secretStore());

    await expect(manager.getAccessToken('connection-1')).rejects.toBeInstanceOf(
      CjApiError,
    );
    await expect(manager.getAccessToken('connection-2')).rejects.toMatchObject({
      reason: 'authentication-failed',
    });
  });

  it('maps network and timeout failures to upstream-unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const manager = new CjTokenManager(secretStore());

    await expect(manager.getAccessToken('connection-1')).rejects.toMatchObject({
      reason: 'upstream-unavailable',
    });
  });

  it('reuses a still-valid persisted token without calling CJ auth', async () => {
    const futureExpiry = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const store = secretStore({
      read: vi.fn().mockResolvedValue({
        ...credentialBundle,
        accessTokenExpiresAt: futureExpiry,
      }),
    });
    const manager = new CjTokenManager(store);

    await expect(manager.getAccessToken('connection-1')).resolves.toBe(
      'old-access-token',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();

    // Second call served from the in-memory cache: no further store read.
    await expect(manager.getAccessToken('connection-1')).resolves.toBe(
      'old-access-token',
    );
    expect(store.read).toHaveBeenCalledOnce();
  });

  it('re-authenticates when the persisted token is expired', async () => {
    const manager = new CjTokenManager(secretStore());

    await expect(manager.getAccessToken('connection-1')).resolves.toBe(
      'fresh-access-token',
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent refreshes into a single CJ auth call', async () => {
    let resolveAuth: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveAuth = resolve;
          }),
      ),
    );
    const store = secretStore();
    const manager = new CjTokenManager(store);

    const tokens = Promise.all([
      manager.getAccessToken('connection-1'),
      manager.getAccessToken('connection-1'),
      manager.getAccessToken('connection-1'),
    ]);

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    resolveAuth(accessTokenResponse());

    await expect(tokens).resolves.toEqual([
      'fresh-access-token',
      'fresh-access-token',
      'fresh-access-token',
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(store.read).toHaveBeenCalledOnce();
  });
});
