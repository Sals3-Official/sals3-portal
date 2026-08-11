import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { fakeDb, callsOf, lastCallArgs } from '../../../../test/fake-db';
import {
  advanceReconciliation,
  coverPartition,
  failPartition,
  leaseExhaustedPartition,
  leasePartition,
  markPartitionUnresolved,
  releasePartitionLease,
} from './partition-repository';
import { MAX_PARTITION_ATTEMPTS } from './config';

const dialect = new PgDialect();

function renderSql(sql: unknown): { sql: string; params: unknown[] } {
  if (sql === undefined) {
    throw new Error('Expected a defined SQL condition, got undefined.');
  }

  return dialect.sqlToQuery(sql as SQL);
}

const FUTURE = new Date(Date.now() + 300_000);
const PAST = new Date(Date.now() - 1_000);

function partitionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'partition-1',
    cycleId: 'cycle-1',
    supplierConnectionId: 'connection-1',
    state: 'PENDING',
    attempts: 0,
    stateVersion: 1,
    leaseToken: null,
    leasedUntil: null,
    passChecksums: [],
    reconcileAttempts: 0,
    ...overrides,
  };
}

describe('leasePartition', () => {
  it('leases a free PENDING partition and increments the bounded attempt count', async () => {
    const row = partitionRow();
    const { db, calls } = fakeDb([
      [row],
      [{ ...row, leaseToken: 'worker-1', leasedUntil: FUTURE, attempts: 1 }],
    ]);

    const lease = await leasePartition(db, {
      partitionId: 'partition-1',
      leaseToken: 'worker-1',
    });

    expect(lease).not.toBeNull();
    expect(lease?.row.attempts).toBe(1);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.attempts).toBe(1);
    expect(set.leaseToken).toBe('worker-1');
  });

  it('refuses while another worker holds a live lease', async () => {
    const { db, calls } = fakeDb([
      [partitionRow({ leaseToken: 'worker-1', leasedUntil: FUTURE })],
    ]);

    const lease = await leasePartition(db, {
      partitionId: 'partition-1',
      leaseToken: 'worker-2',
    });

    expect(lease).toBeNull();
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });

  it('grants the lease once the previous lease expired (crashed-worker recovery)', async () => {
    const row = partitionRow({ leaseToken: 'worker-1', leasedUntil: PAST });
    const { db } = fakeDb([
      [row],
      [{ ...row, leaseToken: 'worker-2', leasedUntil: FUTURE, attempts: 1 }],
    ]);

    const lease = await leasePartition(db, {
      partitionId: 'partition-1',
      leaseToken: 'worker-2',
    });

    expect(lease).not.toBeNull();
  });

  it('refuses a terminal partition (duplicate/out-of-order delivery is a no-op)', async () => {
    const { db, calls } = fakeDb([[partitionRow({ state: 'COVERED' })]]);

    const lease = await leasePartition(db, {
      partitionId: 'partition-1',
      leaseToken: 'worker-1',
    });

    expect(lease).toBeNull();
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });

  it('refuses an attempts-exhausted partition - exhaustion routes to the failure path, never silent retries', async () => {
    const { db, calls } = fakeDb([
      [partitionRow({ attempts: MAX_PARTITION_ATTEMPTS })],
    ]);

    const lease = await leasePartition(db, {
      partitionId: 'partition-1',
      leaseToken: 'worker-1',
    });

    expect(lease).toBeNull();
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });
});

describe('leaseExhaustedPartition', () => {
  it('leases an exhausted unleased partition purely for the FAILED transition', async () => {
    const row = partitionRow({ attempts: MAX_PARTITION_ATTEMPTS });
    const { db } = fakeDb([
      [row],
      [{ ...row, leaseToken: 'fail-worker', leasedUntil: FUTURE }],
    ]);

    const lease = await leaseExhaustedPartition(db, {
      partitionId: 'partition-1',
      leaseToken: 'fail-worker',
    });

    expect(lease).not.toBeNull();
  });

  it('refuses a partition still under its attempt budget', async () => {
    const { db, calls } = fakeDb([[partitionRow({ attempts: 1 })]]);

    const lease = await leaseExhaustedPartition(db, {
      partitionId: 'partition-1',
      leaseToken: 'fail-worker',
    });

    expect(lease).toBeNull();
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });
});

describe('guarded transitions - the exact-lease CAS predicate', () => {
  it.each([
    [
      'coverPartition',
      () =>
        coverPartition(fakeDb([[]]).db, {
          partitionId: 'partition-1',
          leaseToken: 'worker-1',
          reportedTotal: 10,
          uniquePidCount: 10,
          passChecksums: ['c1'],
        }),
    ],
  ])('%s matches id + lease token + unexpired lease', async (_name, run) => {
    await run();
  });

  it('coverPartition CAS clause requires the exact lease token and a live lease', async () => {
    const { db, calls } = fakeDb([[]]);

    await coverPartition(db, {
      partitionId: 'partition-1',
      leaseToken: 'worker-1',
      reportedTotal: 10,
      uniquePidCount: 10,
      passChecksums: ['c1'],
    });

    const rendered = renderSql(lastCallArgs(calls, 'where')[0]);
    expect(rendered.sql).toContain('"lease_token" = ');
    expect(rendered.sql).toContain('"leased_until" > now()');
    expect(rendered.params).toContain('worker-1');
    expect(rendered.params).toContain('partition-1');
  });

  it('a stale worker whose lease was reclaimed cannot release, fail, or unresolve the partition', async () => {
    // Each resolves against zero matched rows - the WHERE clause simply
    // matches nothing for a stale token, so nothing mutates.
    await expect(
      releasePartitionLease(fakeDb([[]]).db, {
        partitionId: 'partition-1',
        leaseToken: 'stale-worker',
        errorCode: 'X',
      }),
    ).resolves.not.toThrow();
    await expect(
      failPartition(fakeDb([[]]).db, {
        partitionId: 'partition-1',
        leaseToken: 'stale-worker',
        errorCode: 'X',
      }),
    ).resolves.toBe(false);
    await expect(
      markPartitionUnresolved(fakeDb([[]]).db, {
        partitionId: 'partition-1',
        leaseToken: 'stale-worker',
        unresolvedReason: 'X',
        reportedTotal: null,
      }),
    ).resolves.toBe(false);
  });

  it('failPartition and markPartitionUnresolved report whether the guarded transition happened', async () => {
    const { db: dbHit } = fakeDb([[{ id: 'partition-1' }]]);
    const { db: dbMiss } = fakeDb([[]]);

    await expect(
      failPartition(dbHit, {
        partitionId: 'partition-1',
        leaseToken: 'worker-1',
        errorCode: 'X',
      }),
    ).resolves.toBe(true);
    await expect(
      markPartitionUnresolved(dbMiss, {
        partitionId: 'partition-1',
        leaseToken: 'worker-1',
        unresolvedReason: 'X',
        reportedTotal: 1,
      }),
    ).resolves.toBe(false);
  });

  it('releasePartitionLease never moves the reconciliation cursor or state', async () => {
    const { db, calls } = fakeDb([[]]);

    await releasePartitionLease(db, {
      partitionId: 'partition-1',
      leaseToken: 'worker-1',
      errorCode: 'PROVIDER_FETCH_FAILED',
    });

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.leaseToken).toBeNull();
    expect(set.leasedUntil).toBeNull();
    expect('state' in set).toBe(false);
    expect('reconcileNextPage' in set).toBe(false);
    expect('reconcilePass' in set).toBe(false);
  });

  it('releasePartitionLease can undo the lease-time attempt increment for local pacing parks', async () => {
    const { db, calls } = fakeDb([[]]);

    await releasePartitionLease(db, {
      partitionId: 'partition-1',
      leaseToken: 'worker-1',
      errorCode: 'RATE_SLOT_UNAVAILABLE',
      consumeAttempt: false,
    });

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    const rendered = renderSql(set.attempts);
    expect(rendered.sql).toContain('greatest');
    expect(rendered.sql).toContain('"attempts" - ');
    expect(rendered.sql).toContain('1');
  });

  it('advanceReconciliation returns false when the lease was lost - the cursor can never advance twice', async () => {
    const { db } = fakeDb([[]]);

    await expect(
      advanceReconciliation(db, {
        partitionId: 'partition-1',
        leaseToken: 'stale-worker',
        reconcilePass: 1,
        reconcileNextPage: 5,
        reportedTotal: 900,
        releaseLease: false,
      }),
    ).resolves.toBe(false);
  });
});
