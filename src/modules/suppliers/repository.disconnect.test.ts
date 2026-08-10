import { describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { supplierAccountBindings } from '@/lib/db/schema/supplier-account-bindings';
import {
  claimAccountBinding,
  disconnectConnection,
  findAccountBinding,
  reconnectConnection,
} from './repository';

/**
 * Verifies the disconnect/reconnect repository functions - the update-in-
 * place shape that lets a seller reconnect the same connection row (the
 * unique `(sellerAccountId, providerId)` index forbids a second row) - and
 * the binding-ledger functions that decide whether a CJ account may be
 * connected at all.
 */
function fakeUpdateExecutor(returnedRows: unknown[]) {
  const builder = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returnedRows),
  };

  return builder as never;
}

function fakeSelectExecutor(resolvedRows: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolvedRows),
  };

  return builder as never;
}

/**
 * `claimAccountBinding` inserts, then falls back to a select when the insert
 * conflicted, so this fake has to answer both in one object.
 */
function fakeInsertExecutor(
  insertedRows: unknown[],
  selectedRows: unknown[] = [],
) {
  const builder = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(insertedRows),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectedRows),
  };

  return builder as never;
}

describe('disconnectConnection', () => {
  it('sets status to DISCONNECTED and stamps disconnectedAt', async () => {
    const executor = fakeUpdateExecutor([]);

    await disconnectConnection(executor, 'connection-a');

    const setArg = (executor as { set: ReturnType<typeof vi.fn> }).set.mock
      .calls[0][0];

    expect(setArg.status).toBe('DISCONNECTED');
    expect(setArg.disconnectedAt).toBeInstanceOf(Date);
  });
});

describe('reconnectConnection', () => {
  it('updates the same row back to CONNECTED and clears disconnect state', async () => {
    const returned = { id: 'connection-a', status: 'CONNECTED' };
    const executor = fakeUpdateExecutor([returned]);

    const result = await reconnectConnection(executor, 'connection-a', {
      displayName: 'CJ Dropshipping',
      externalAccountLookupHash: 'hash-a',
      externalAccountMasked: 'CJ...1234',
      accessTokenExpiresAt: new Date('2026-08-08T00:00:00Z'),
      lastVerifiedAt: new Date('2026-08-07T00:00:00Z'),
    });

    const setArg = (executor as { set: ReturnType<typeof vi.fn> }).set.mock
      .calls[0][0];

    expect(setArg.status).toBe('CONNECTED');
    expect(setArg.disconnectedAt).toBeNull();
    expect(setArg.lastErrorCode).toBeNull();
    expect(result).toBe(returned);
  });

  it('throws if the row is gone by the time the update returns', async () => {
    const executor = fakeUpdateExecutor([]);

    await expect(
      reconnectConnection(executor, 'connection-a', {
        displayName: 'CJ Dropshipping',
        externalAccountLookupHash: 'hash-a',
        externalAccountMasked: 'CJ...1234',
        accessTokenExpiresAt: new Date(),
        lastVerifiedAt: new Date(),
      }),
    ).rejects.toThrow('Connection disappeared during reconnect.');
  });
});

describe('findAccountBinding', () => {
  it('looks the binding up by provider and account hash', async () => {
    const executor = fakeSelectExecutor([]);

    await findAccountBinding(executor, 'provider-a', 'hash-a');

    const whereArg = (executor as { where: ReturnType<typeof vi.fn> }).where
      .mock.calls[0][0];
    const expected = and(
      eq(supplierAccountBindings.providerId, 'provider-a'),
      eq(supplierAccountBindings.externalAccountLookupHash, 'hash-a'),
    );

    expect(String(whereArg)).toBe(String(expected));
  });
});

/**
 * The binding ledger is what makes "one CJ account belongs to one seller
 * account" permanent, so the case that matters is the *conflict*: the claim
 * must read back whoever already owns the account instead of throwing or
 * returning null, because the caller has to tell "already mine" apart from
 * "already someone else's".
 */
describe('claimAccountBinding', () => {
  it('returns the inserted row when the account is unclaimed', async () => {
    const inserted = { id: 'binding-a', sellerAccountId: 'seller-a' };
    const executor = fakeInsertExecutor([inserted]);

    const result = await claimAccountBinding(executor, {
      providerId: 'provider-a',
      externalAccountLookupHash: 'hash-a',
      sellerAccountId: 'seller-a',
    });

    expect(result).toBe(inserted);
  });

  it('reads back the existing owner when the account is already claimed', async () => {
    const owner = { id: 'binding-a', sellerAccountId: 'seller-b' };
    const executor = fakeInsertExecutor([], [owner]);

    const result = await claimAccountBinding(executor, {
      providerId: 'provider-a',
      externalAccountLookupHash: 'hash-a',
      sellerAccountId: 'seller-a',
    });

    expect(result).toBe(owner);
  });

  it('throws when the insert conflicted but nothing can be read back', async () => {
    const executor = fakeInsertExecutor([], []);

    await expect(
      claimAccountBinding(executor, {
        providerId: 'provider-a',
        externalAccountLookupHash: 'hash-a',
        sellerAccountId: 'seller-a',
      }),
    ).rejects.toThrow('could not be read back');
  });
});
