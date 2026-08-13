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
});
