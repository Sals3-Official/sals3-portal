import { describe, expect, it } from 'vitest';
import { fakeDb, callsOf, lastCallArgs } from '../../../../test/fake-db';
import {
  advanceSeedCursor,
  createCycleIfAbsent,
  markSeedingComplete,
  tryFinishCycle,
} from './cycle-repository';

function cycleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cycle-1',
    supplierConnectionId: 'connection-1',
    cycleCutoff: new Date('2026-08-11T00:00:00Z'),
    state: 'RUNNING',
    categorySnapshot: [],
    seedCursor: -1,
    partitionsTotal: 10,
    partitionsTerminal: 10,
    partitionsUnresolved: 0,
    stateVersion: 1,
    ...overrides,
  };
}

describe('createCycleIfAbsent', () => {
  it('returns the existing active cycle without inserting (idempotent start)', async () => {
    const existing = cycleRow({ state: 'SEEDING' });
    const { db, calls } = fakeDb([[existing]]);

    const result = await createCycleIfAbsent(db, {
      supplierConnectionId: 'connection-1',
      cycleCutoff: new Date(),
    });

    expect(result.created).toBe(false);
    expect(result.cycle.id).toBe('cycle-1');
    expect(callsOf(calls, 'insert')).toHaveLength(0);
  });

  it('creates the cycle when none is active', async () => {
    const fresh = cycleRow({ state: 'SEEDING', seedCursor: 0 });
    const { db, calls } = fakeDb([[], [fresh]]);

    const result = await createCycleIfAbsent(db, {
      supplierConnectionId: 'connection-1',
      cycleCutoff: new Date(),
    });

    expect(result.created).toBe(true);
    expect(callsOf(calls, 'onConflictDoNothing')).toHaveLength(1);
  });

  it('two concurrent starts cannot create two active chains - the loser of the unique-index race reads the winner back', async () => {
    const winner = cycleRow({ state: 'SEEDING' });
    // select (none) -> insert conflicts (returns []) -> re-read finds winner.
    const { db } = fakeDb([[], [], [winner]]);

    const result = await createCycleIfAbsent(db, {
      supplierConnectionId: 'connection-1',
      cycleCutoff: new Date(),
    });

    expect(result.created).toBe(false);
    expect(result.cycle.id).toBe('cycle-1');
  });
});

describe('advanceSeedCursor', () => {
  it('CAS on the exact previous cursor - a duplicate delivery that lost the race updates nothing', async () => {
    const { db } = fakeDb([[]]);

    await expect(
      advanceSeedCursor(db, {
        cycleId: 'cycle-1',
        fromCursor: 100,
        toCursor: 200,
        partitionsAdded: 200,
      }),
    ).resolves.toBe(false);
  });

  it('advances the cursor and the partition total together', async () => {
    const { db, calls } = fakeDb([[{ id: 'cycle-1' }]]);

    await expect(
      advanceSeedCursor(db, {
        cycleId: 'cycle-1',
        fromCursor: 0,
        toCursor: 100,
        partitionsAdded: 200,
      }),
    ).resolves.toBe(true);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.seedCursor).toBe(100);
  });
});

describe('markSeedingComplete', () => {
  it('transitions SEEDING -> RUNNING with cursor -1, guarded on SEEDING', async () => {
    const { db, calls } = fakeDb([[{ id: 'cycle-1' }]]);

    await expect(markSeedingComplete(db, 'cycle-1')).resolves.toBe(true);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.seedCursor).toBe(-1);
    expect(set.state).toBe('RUNNING');
  });
});

describe('tryFinishCycle - completion is blocked by every incomplete or unresolved descendant', () => {
  it.each([
    [
      'seeding still in progress',
      cycleRow({ state: 'SEEDING', seedCursor: 5 }),
    ],
    ['seed cursor not finished', cycleRow({ seedCursor: 3 })],
    [
      'a queued/leased/retryable partition remains',
      cycleRow({ partitionsTerminal: 9 }),
    ],
  ])('%s -> STILL_RUNNING, no state change', async (_label, row) => {
    const { db, calls } = fakeDb([[row]]);

    await expect(
      tryFinishCycle(db, { cycleId: 'cycle-1', blockedPartitions: 0 }),
    ).resolves.toBe('STILL_RUNNING');
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });

  it('every partition terminal and none unresolved/failed -> COMPLETE', async () => {
    const { db, calls } = fakeDb([[cycleRow()], [{ id: 'cycle-1' }]]);

    await expect(
      tryFinishCycle(db, { cycleId: 'cycle-1', blockedPartitions: 0 }),
    ).resolves.toBe('COMPLETE');

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.state).toBe('COMPLETE');
  });

  it('an unresolved partition forces COVERAGE_UNRESOLVED - never a silent COMPLETE', async () => {
    const { db, calls } = fakeDb([
      [cycleRow({ partitionsUnresolved: 1 })],
      [{ id: 'cycle-1' }],
    ]);

    await expect(
      tryFinishCycle(db, { cycleId: 'cycle-1', blockedPartitions: 1 }),
    ).resolves.toBe('COVERAGE_UNRESOLVED');

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.state).toBe('COVERAGE_UNRESOLVED');
  });

  it('a FAILED partition (counted via blockedPartitions) also blocks COMPLETE', async () => {
    const { db } = fakeDb([[cycleRow()], [{ id: 'cycle-1' }]]);

    await expect(
      tryFinishCycle(db, { cycleId: 'cycle-1', blockedPartitions: 2 }),
    ).resolves.toBe('COVERAGE_UNRESOLVED');
  });

  it('returns STILL_RUNNING when the guarded final update lost a concurrent race', async () => {
    const { db } = fakeDb([[cycleRow()], []]);

    await expect(
      tryFinishCycle(db, { cycleId: 'cycle-1', blockedPartitions: 0 }),
    ).resolves.toBe('STILL_RUNNING');
  });
});
