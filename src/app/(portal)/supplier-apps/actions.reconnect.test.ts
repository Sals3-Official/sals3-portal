// @vitest-environment node
//
// The `'use server'` action file transitively imports the `server-only`
// package, which throws when resolved under the jsdom environment's
// "browser" package-export condition - the plain Node environment avoids
// that condition entirely, same fix as `queries.pipeline.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
}));

vi.mock('@/lib/auth/seller-guard', () => ({
  requireDropshipperAccount: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true })),
}));

const {
  findConnectionBySellerAndProviderMock,
  findConnectionByProviderAndHashMock,
  findProviderByCodeMock,
  insertConnectionMock,
  reconnectConnectionMock,
} = vi.hoisted(() => ({
  findConnectionBySellerAndProviderMock: vi.fn(),
  findConnectionByProviderAndHashMock: vi.fn(),
  findProviderByCodeMock: vi.fn(),
  insertConnectionMock: vi.fn(),
  reconnectConnectionMock: vi.fn(),
}));

vi.mock('@/modules/suppliers/repository', () => ({
  disconnectConnection: vi.fn(),
  findConnectionByProviderAndHash: findConnectionByProviderAndHashMock,
  findConnectionBySellerAndProvider: findConnectionBySellerAndProviderMock,
  findProviderByCode: findProviderByCodeMock,
  insertConnection: insertConnectionMock,
  reconnectConnection: reconnectConnectionMock,
}));

const { appendAuditEventMock, requeueConnectionPausedEvaluationsMock } =
  vi.hoisted(() => ({
    appendAuditEventMock: vi.fn(),
    requeueConnectionPausedEvaluationsMock: vi.fn(),
  }));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: appendAuditEventMock,
  requeueConnectionPausedEvaluations: requeueConnectionPausedEvaluationsMock,
}));

vi.mock('@/lib/secrets/postgres-supplier-secret-store', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockSecretStore() {
    return { write: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/security/step-up-challenge', () => ({
  createStepUpChallenge: vi.fn(),
  verifyStepUpChallenge: vi.fn(),
}));

// eslint-disable-next-line import/first
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
// eslint-disable-next-line import/first
import { connectCjSupplier } from './actions';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SESSION = {
  session: { userId: 'user-1' },
  sellerAccount: { id: 'seller-1' },
};
const PROVIDER = { id: 'provider-1', code: 'CJ_DROPSHIPPING' };

function mockCjVerificationFetch() {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      code: 200,
      message: 'ok',
      data: {
        openId: 123456,
        accessToken: 'token',
        accessTokenExpiryDate: new Date(Date.now() + 3_600_000).toISOString(),
        refreshToken: 'refresh',
        refreshTokenExpiryDate: new Date(
          Date.now() + 7 * 86_400_000,
        ).toISOString(),
      },
    }),
  } as unknown as Response);
}

describe('connectCjSupplier - reconnect-triggered requeue', () => {
  beforeEach(() => {
    asMock(requireDropshipperAccount).mockResolvedValue(SESSION);
    findProviderByCodeMock.mockReset().mockResolvedValue(PROVIDER);
    findConnectionByProviderAndHashMock.mockReset().mockResolvedValue(null);
    appendAuditEventMock.mockReset().mockResolvedValue(undefined);
    requeueConnectionPausedEvaluationsMock.mockReset().mockResolvedValue(0);
    insertConnectionMock.mockReset();
    reconnectConnectionMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not requeue anything for a brand-new connection (nothing could be paused yet)', async () => {
    findConnectionBySellerAndProviderMock.mockReset().mockResolvedValue(null);
    insertConnectionMock.mockResolvedValue({
      id: 'connection-new',
      displayName: 'CJ Dropshipping',
      status: 'CONNECTED',
    });
    mockCjVerificationFetch();

    const result = await connectCjSupplier({ apiKey: 'key-123' });

    expect(result.ok).toBe(true);
    expect(requeueConnectionPausedEvaluationsMock).not.toHaveBeenCalled();
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'supplier_connection.created' }),
    );
  });

  it('requeues connection-paused evaluations on reconnect and reports the count in the audit event', async () => {
    findConnectionBySellerAndProviderMock.mockReset().mockResolvedValue({
      id: 'connection-existing',
      status: 'DISCONNECTED',
    });
    reconnectConnectionMock.mockResolvedValue({
      id: 'connection-existing',
      displayName: 'CJ Dropshipping',
      status: 'CONNECTED',
    });
    requeueConnectionPausedEvaluationsMock.mockResolvedValue(3);
    mockCjVerificationFetch();

    const result = await connectCjSupplier({ apiKey: 'key-123' });

    expect(result.ok).toBe(true);
    expect(requeueConnectionPausedEvaluationsMock).toHaveBeenCalledWith(
      expect.anything(),
      'connection-existing',
    );
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'supplier_connection.reconnected',
        payload: expect.objectContaining({ requeuedEvaluationCount: 3 }),
      }),
    );
  });

  it('requeues zero without error when the reconnected connection had nothing paused', async () => {
    findConnectionBySellerAndProviderMock.mockReset().mockResolvedValue({
      id: 'connection-existing',
      status: 'REAUTH_REQUIRED',
    });
    reconnectConnectionMock.mockResolvedValue({
      id: 'connection-existing',
      displayName: 'CJ Dropshipping',
      status: 'CONNECTED',
    });
    requeueConnectionPausedEvaluationsMock.mockResolvedValue(0);
    mockCjVerificationFetch();

    const result = await connectCjSupplier({ apiKey: 'key-123' });

    expect(result.ok).toBe(true);
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ requeuedEvaluationCount: 0 }),
      }),
    );
  });
});
