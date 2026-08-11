import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `connectCjSupplier` enforces two rules that have to hold under
 * concurrency: one seller account gets one supplier configuration per
 * provider, and one CJ account belongs to one seller account permanently.
 *
 * The load-bearing assertion in this file is the TX-identity one in "happy
 * insert". The secret write must run on the transaction's own connection,
 * because the connection row it references is still uncommitted; issuing it
 * on the pooled client instead makes every first-time connect fail on a
 * foreign key. Without a database in the test environment, comparing which
 * executor object each call received is the only way to catch that.
 */

const TX = { __tx: true } as const;

const { getDbMock, transactionMock } = vi.hoisted(() => {
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ __tx: true }),
  );

  return {
    transactionMock: transaction,
    getDbMock: vi.fn(() => ({ __pool: true, transaction })),
  };
});

vi.mock('@/lib/db/client', () => ({ default: getDbMock }));

const { requireDropshipperAccountMock } = vi.hoisted(() => ({
  requireDropshipperAccountMock: vi.fn(),
}));

vi.mock('@/lib/auth/seller-guard', () => ({
  requireDropshipperAccount: requireDropshipperAccountMock,
}));

const { checkRateLimitMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(() => ({ allowed: true })),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: checkRateLimitMock }));

vi.mock('@/modules/suppliers/repository', () => ({
  findProviderByCode: vi.fn(),
  findConnectionBySellerAndProvider: vi.fn(),
  findAccountBinding: vi.fn(),
  claimAccountBinding: vi.fn(),
  insertConnection: vi.fn(),
  reconnectConnection: vi.fn(),
  disconnectConnection: vi.fn(),
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
  requeueConnectionPausedEvaluations: vi.fn(),
}));

vi.mock('@/modules/catalog/discovery/outbox-repository', () => ({
  insertOutboxIntents: vi.fn(),
}));

vi.mock('@/modules/catalog/discovery/outbox-dispatch', () => ({
  default: vi.fn().mockResolvedValue({ dispatched: 1, failed: 0 }),
}));

const { secretWriteMock } = vi.hoisted(() => ({ secretWriteMock: vi.fn() }));

vi.mock('@/lib/secrets/postgres-supplier-secret-store', () => ({
  // A real `function`, not an arrow: the code under test calls `new ...()`.
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockClass() {
    return { write: secretWriteMock };
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/security/step-up-challenge', () => ({
  createStepUpChallenge: vi.fn(),
  verifyStepUpChallenge: vi.fn(),
}));

/* eslint-disable import/first */
import {
  SUPPLIER_ACCOUNT_BINDINGS_PROVIDER_HASH_KEY,
  SUPPLIER_CONNECTIONS_PROVIDER_EXTERNAL_HASH_KEY,
  SUPPLIER_CONNECTIONS_SELLER_PROVIDER_KEY,
} from '@/lib/db/schema';
import { PermissionError } from '@/lib/auth/permissions';
import {
  appendAuditEvent,
  requeueConnectionPausedEvaluations,
} from '@/modules/catalog/candidates/repository';
import {
  claimAccountBinding,
  findAccountBinding,
  findConnectionBySellerAndProvider,
  findProviderByCode,
  insertConnection,
  reconnectConnection,
} from '@/modules/suppliers/repository';
import { connectCjSupplier } from './actions';
/* eslint-enable import/first */

const SELLER_ID = 'seller-a';
const OTHER_SELLER_ID = 'seller-b';
const PROVIDER = { id: 'provider-cj', code: 'CJ_DROPSHIPPING' };

function cjTokenResponse() {
  return {
    ok: true,
    json: async () => ({
      code: 200,
      data: {
        openId: 998877,
        accessToken: 'access-token',
        accessTokenExpiryDate: '2026-09-01T00:00:00Z',
        refreshToken: 'refresh-token',
        refreshTokenExpiryDate: '2026-12-01T00:00:00Z',
      },
    }),
  };
}

function validInput() {
  return { apiKey: 'CJ123@api@abc', displayName: 'CJ Dropshipping' };
}

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-a',
    displayName: 'CJ Dropshipping',
    status: 'CONNECTED',
    externalAccountLookupHash: 'hash-existing',
    ...overrides,
  };
}

beforeEach(() => {
  // `clearAllMocks` clears recorded calls but keeps implementations, so every
  // mock a test overrides has to be given its default back explicitly here -
  // otherwise a rejection set up by one test silently fails the next one.
  vi.clearAllMocks();

  transactionMock.mockImplementation(
    async (callback: (tx: unknown) => unknown) => callback(TX),
  );
  requireDropshipperAccountMock.mockResolvedValue({
    session: { userId: 'user-a' },
    sellerAccount: { id: SELLER_ID },
  });
  checkRateLimitMock.mockReturnValue({ allowed: true });
  vi.mocked(findProviderByCode).mockResolvedValue(PROVIDER as never);
  vi.mocked(findConnectionBySellerAndProvider).mockResolvedValue(null);
  vi.mocked(findAccountBinding).mockResolvedValue(null);
  vi.mocked(claimAccountBinding).mockResolvedValue({
    sellerAccountId: SELLER_ID,
  } as never);
  vi.mocked(insertConnection).mockResolvedValue(connectionRow() as never);
  vi.mocked(reconnectConnection).mockResolvedValue(connectionRow() as never);
  vi.mocked(appendAuditEvent).mockResolvedValue(undefined);
  vi.mocked(requeueConnectionPausedEvaluations).mockResolvedValue(0);
  secretWriteMock.mockResolvedValue(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => cjTokenResponse()),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('connectCjSupplier - refusals before any CJ call', () => {
  it('rejects malformed input', async () => {
    const result = await connectCjSupplier({ apiKey: '' });

    expect(result).toEqual({ ok: false, reason: 'invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-Dropshipper account', async () => {
    requireDropshipperAccountMock.mockRejectedValue(new PermissionError());

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a rate-limited seller', async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false });

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an unseeded provider rather than guessing one', async () => {
    vi.mocked(findProviderByCode).mockResolvedValue(null);

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'provider_unavailable',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a second configuration for the same seller without spending a CJ call', async () => {
    vi.mocked(findConnectionBySellerAndProvider).mockResolvedValue(
      connectionRow({ status: 'CONNECTED' }) as never,
    );

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'already_connected',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('connectCjSupplier - CJ verification', () => {
  it('reports a key CJ rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 401 }) })),
    );

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'verification_failed',
    });
  });

  it('reports CJ being unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'verification_failed',
    });
  });
});

describe('connectCjSupplier - permanent CJ account binding', () => {
  it('refuses a CJ account bound to another seller, and says so distinctly', async () => {
    vi.mocked(findAccountBinding).mockResolvedValue({
      sellerAccountId: OTHER_SELLER_ID,
    } as never);

    const result = await connectCjSupplier(validInput());

    expect(result).toEqual({ ok: false, reason: 'cj_account_taken' });
    // The whole point of the separate reason: "you already have one" and
    // "somebody else has this one" are different problems for the seller.
    expect(result).not.toEqual({ ok: false, reason: 'already_connected' });
    expect(insertConnection).not.toHaveBeenCalled();
  });

  it('audits the refused bind without recording the CJ account', async () => {
    vi.mocked(findAccountBinding).mockResolvedValue({
      sellerAccountId: OTHER_SELLER_ID,
    } as never);

    await connectCjSupplier(validInput());

    const event = vi.mocked(appendAuditEvent).mock.calls[0][1];

    expect(event.action).toBe('supplier_connection.bind_rejected');
    expect(JSON.stringify(event.payload)).not.toContain('998877');
    expect(JSON.stringify(event.payload)).not.toContain('CJ123@api@abc');
  });

  it('still refuses a clean refusal when the audit write fails', async () => {
    vi.mocked(findAccountBinding).mockResolvedValue({
      sellerAccountId: OTHER_SELLER_ID,
    } as never);
    vi.mocked(appendAuditEvent).mockRejectedValue(new Error('audit down'));

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'cj_account_taken',
    });
  });

  it('allows a seller to connect a different CJ account of their own', async () => {
    vi.mocked(findConnectionBySellerAndProvider).mockResolvedValue(
      connectionRow({
        status: 'DISCONNECTED',
        externalAccountLookupHash: 'hash-old',
      }) as never,
    );

    expect((await connectCjSupplier(validInput())).ok).toBe(true);
    expect(reconnectConnection).toHaveBeenCalled();
  });
});

describe('connectCjSupplier - persistence', () => {
  it('writes the connection, its secret, and its audit on one transaction', async () => {
    const result = await connectCjSupplier(validInput());

    expect(result.ok).toBe(true);
    expect(vi.mocked(claimAccountBinding).mock.calls[0][0]).toBe(TX);
    expect(vi.mocked(insertConnection).mock.calls[0][0]).toBe(TX);
    // The regression guard. `getDb()` here instead of `tx` puts this INSERT on
    // a different pooled connection, where the connection row it references
    // has not committed yet, and every first-time connect fails on the FK.
    expect(secretWriteMock.mock.calls[0][0]).toBe(TX);
    expect(vi.mocked(appendAuditEvent).mock.calls[0][0]).toBe(TX);
  });

  it('claims the binding before writing any connection row', async () => {
    await connectCjSupplier(validInput());

    expect(
      vi.mocked(claimAccountBinding).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(insertConnection).mock.invocationCallOrder[0]);
  });

  it('refuses when the binding is claimed by another seller mid-transaction', async () => {
    vi.mocked(claimAccountBinding).mockResolvedValue({
      sellerAccountId: OTHER_SELLER_ID,
    } as never);

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'cj_account_taken',
    });
  });
});

/**
 * Production, 2026-08-10: the `supplier_account_bindings` read reached a
 * deployment whose database had not run the migration yet. It sat outside any
 * handler, so the Postgres 42P01 escaped the Server Action and the seller got
 * Next's "This page couldn't load" instead of a message. Every read this
 * action makes is a database call and any of them can fail that way, so each
 * one is pinned here.
 */
describe('connectCjSupplier - a failed read is a reason, never a crash', () => {
  const dbDown = () =>
    Object.assign(new Error('Failed query'), {
      cause: { code: '42P01', message: 'relation does not exist' },
    });

  it.each([
    ['the provider lookup', () => vi.mocked(findProviderByCode)],
    [
      'the existing-connection lookup',
      () => vi.mocked(findConnectionBySellerAndProvider),
    ],
    ['the binding lookup', () => vi.mocked(findAccountBinding)],
  ])('returns failed when %s throws', async (_label, pick) => {
    pick().mockRejectedValue(dbDown());

    await expect(connectCjSupplier(validInput())).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });
});

describe('connectCjSupplier - the database as the enforcer', () => {
  function rejectTransactionWith(constraintName: string) {
    transactionMock.mockRejectedValue(
      new Error('Failed query', {
        cause: { code: '23505', constraint_name: constraintName },
      }),
    );
  }

  it('maps a seller/provider unique violation to already_connected', async () => {
    rejectTransactionWith(SUPPLIER_CONNECTIONS_SELLER_PROVIDER_KEY);

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'already_connected',
    });
  });

  it('maps a live-connection hash violation to cj_account_taken', async () => {
    rejectTransactionWith(SUPPLIER_CONNECTIONS_PROVIDER_EXTERNAL_HASH_KEY);

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'cj_account_taken',
    });
  });

  it('maps a binding-ledger violation to cj_account_taken', async () => {
    rejectTransactionWith(SUPPLIER_ACCOUNT_BINDINGS_PROVIDER_HASH_KEY);

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'cj_account_taken',
    });
  });

  it('keeps an unrecognised database error generic', async () => {
    transactionMock.mockRejectedValue(new Error('connection reset'));

    expect(await connectCjSupplier(validInput())).toEqual({
      ok: false,
      reason: 'failed',
    });
  });
});
