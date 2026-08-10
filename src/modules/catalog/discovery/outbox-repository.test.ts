import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { fakeDb, callsOf, lastCallArgs } from '../../../../test/fake-db';
import {
  claimDispatchableOutbox,
  insertOutboxIntents,
  markOutboxDispatched,
  releaseOutboxAttempt,
} from './outbox-repository';
import { MAX_OUTBOX_ATTEMPTS } from './config';

const dialect = new PgDialect();

describe('insertOutboxIntents', () => {
  it('deduplicates on the idempotency key - the same logical successor is only ever recorded once', async () => {
    const { db, calls } = fakeDb([[]]);

    await insertOutboxIntents(db, [
      {
        message: {
          v: 1,
          operation: 'OUTBOX_DISPATCH',
          idempotencyKey: 'k-1',
        },
      },
    ]);

    expect(callsOf(calls, 'onConflictDoNothing')).toHaveLength(1);
    const values = lastCallArgs(calls, 'values')[0] as Array<
      Record<string, unknown>
    >;
    expect(values[0]!.idempotencyKey).toBe('k-1');
    expect(values[0]!.notBefore).toBeNull();
  });

  it('records the queue delay as notBefore', async () => {
    const { db, calls } = fakeDb([[]]);

    await insertOutboxIntents(db, [
      {
        message: { v: 1, operation: 'OUTBOX_DISPATCH', idempotencyKey: 'k-2' },
        delaySeconds: 600,
      },
    ]);

    const values = lastCallArgs(calls, 'values')[0] as Array<
      Record<string, unknown>
    >;
    expect(values[0]!.notBefore).toBeInstanceOf(Date);
  });

  it('is a no-op for an empty intent list', async () => {
    const { db, calls } = fakeDb([[]]);

    await insertOutboxIntents(db, []);

    expect(callsOf(calls, 'insert')).toHaveLength(0);
  });
});

describe('markOutboxDispatched', () => {
  it('confirms publication only for the exact lease holder (CAS)', async () => {
    const { db, calls } = fakeDb([[]]);

    await markOutboxDispatched(db, { id: 'outbox-1', leaseToken: 'lease-1' });

    const rendered = dialect.sqlToQuery(lastCallArgs(calls, 'where')[0] as SQL);
    expect(rendered.sql).toContain('"lease_token" = ');
    expect(rendered.params).toEqual(['outbox-1', 'lease-1']);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.state).toBe('DISPATCHED');
  });
});

describe('releaseOutboxAttempt', () => {
  it('returns the row to PENDING and preserves its scheduled notBefore - retry pacing belongs to the transport redelivery, not this row', async () => {
    const { db, calls } = fakeDb([[]]);

    await releaseOutboxAttempt(db, {
      id: 'outbox-1',
      leaseToken: 'lease-1',
      attempts: 2,
      errorCode: 'QUEUE_PUBLISH_FAILED',
    });

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.state).toBe('PENDING');
    // The scheduled delivery time must never be overwritten by a publish
    // failure - it is the message's delaySeconds source.
    expect('notBefore' in set).toBe(false);
    expect(set.lastErrorCode).toBe('QUEUE_PUBLISH_FAILED');
  });

  it('marks the row FAILED - visibly, never silently dropped - once attempts are exhausted', async () => {
    const { db, calls } = fakeDb([[]]);

    await releaseOutboxAttempt(db, {
      id: 'outbox-1',
      leaseToken: 'lease-1',
      attempts: MAX_OUTBOX_ATTEMPTS,
      errorCode: 'QUEUE_PUBLISH_FAILED',
    });

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.state).toBe('FAILED');
  });
});

describe('claimDispatchableOutbox', () => {
  it('claims delayed rows immediately - the transport holds them via delaySeconds; notBefore never gates the claim', async () => {
    const { db, calls } = fakeDb([[{ id: 'outbox-1' }], [{ id: 'outbox-1' }]]);

    await claimDispatchableOutbox(db, { leaseToken: 'lease-1', batchSize: 10 });

    const whereArg = callsOf(calls, 'where')[0]!.args[0];
    const rendered = dialect.sqlToQuery(whereArg as SQL);

    // Chain-stall regression guard: a future notBefore must not exclude a
    // row from dispatch, or delayed sweeps/retries/next cycles never fire.
    expect(rendered.sql).not.toContain('not_before');
    expect(rendered.sql).toContain('"state" = ');
    expect(rendered.sql).toContain('"leased_until"');
  });
});
