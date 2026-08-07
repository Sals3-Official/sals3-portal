import { describe, expect, it, vi } from 'vitest';
import { and, eq, ne } from 'drizzle-orm';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';
import {
  disconnectConnection,
  findConnectionByProviderAndHash,
  reconnectConnection,
} from './repository';

/**
 * Verifies the disconnect/reconnect repository functions - the update-in-
 * place shape that lets a seller reconnect the same connection row (the
 * unique `(sellerAccountId, providerId)` index forbids a second row), and
 * that the duplicate-account lookup excludes the connection being
 * reconnected so re-verifying its own CJ account never reads back as
 * "another seller already has this account".
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

describe('findConnectionByProviderAndHash', () => {
  it('excludes the given connection id from the duplicate-account lookup', async () => {
    const executor = fakeSelectExecutor([]);

    await findConnectionByProviderAndHash(
      executor,
      'provider-a',
      'hash-a',
      'connection-a',
    );

    const whereArg = (executor as { where: ReturnType<typeof vi.fn> }).where
      .mock.calls[0][0];
    const expected = and(
      eq(supplierConnections.providerId, 'provider-a'),
      eq(supplierConnections.externalAccountLookupHash, 'hash-a'),
      ne(supplierConnections.id, 'connection-a'),
    );

    expect(String(whereArg)).toBe(String(expected));
  });

  it('omits the exclusion condition when no connection id is given', async () => {
    const executor = fakeSelectExecutor([]);

    await findConnectionByProviderAndHash(executor, 'provider-a', 'hash-a');

    const whereArg = (executor as { where: ReturnType<typeof vi.fn> }).where
      .mock.calls[0][0];
    const expected = and(
      eq(supplierConnections.providerId, 'provider-a'),
      eq(supplierConnections.externalAccountLookupHash, 'hash-a'),
      undefined,
    );

    expect(String(whereArg)).toBe(String(expected));
  });
});
