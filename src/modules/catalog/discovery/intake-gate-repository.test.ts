import { describe, expect, it } from 'vitest';
import { fakeDb, lastCallArgs } from '../../../../test/fake-db';
import {
  advancePidCapacityWave,
  assessIntakeGate,
  countActiveEvaluationWork,
  tryConsumeNewPidCapacity,
} from './intake-gate-repository';

const CONNECTION_ID = '6aa82ace-e1bb-42cb-88b0-af5e0917d0f5';

function backlogGate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gate-1',
    supplierConnectionId: CONNECTION_ID,
    activationAt: new Date('2026-08-12T00:00:00Z'),
    baselineBacklogCount: 0,
    state: 'DRAIN_COMPLETE',
    lastObservedBacklog: 0,
    lastEvaluatedAt: new Date('2026-08-12T00:00:00Z'),
    drainCompletedAt: new Date('2026-08-12T00:00:00Z'),
    stateVersion: 1,
    createdAt: new Date('2026-08-12T00:00:00Z'),
    updatedAt: new Date('2026-08-12T00:00:00Z'),
    ...overrides,
  };
}

function capacity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'capacity-1',
    supplierConnectionId: CONNECTION_ID,
    limitValue: 600,
    admittedCount: 600,
    lastAdmittedAt: new Date('2026-08-12T00:00:00Z'),
    capReachedAt: new Date('2026-08-12T00:00:00Z'),
    createdAt: new Date('2026-08-12T00:00:00Z'),
    updatedAt: new Date('2026-08-12T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Every curated lane already exhausted for wave edge 600, so a `PARTITION`
 * caller is not held back by intake priority and the wave-capacity behaviour
 * under test is reachable. Priority itself is covered separately below.
 */
function allLanesExhausted(waveLimit = 600) {
  return [
    { lane: 'CJ_TRENDING', exhaustedAtWaveLimit: waveLimit },
    { lane: 'CJ_MOST_LISTED', exhaustedAtWaveLimit: waveLimit },
    { lane: 'CJ_NEW_ARRIVALS', exhaustedAtWaveLimit: waveLimit },
  ];
}

describe('assessIntakeGate - rolling new-PID waves', () => {
  it('blocks supplier calls at the wave edge while active pipeline work remains', async () => {
    const { db } = fakeDb([
      [backlogGate()],
      [],
      [capacity()],
      allLanesExhausted(),
      [{ total: 9 }],
    ]);

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'PARTITION',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'NEW_PID_WAVE_DRAIN_PENDING',
      activeEvaluationWork: 9,
      waveSize: 600,
      limitValue: 600,
      admittedCount: 600,
    });
  });

  it('opens the next 600-product wave once active pipeline work reaches zero', async () => {
    const { db } = fakeDb([
      [backlogGate()],
      [],
      [capacity()],
      allLanesExhausted(),
      [{ total: 0 }],
      [{ id: 'capacity-1' }],
      [capacity({ limitValue: 1200, admittedCount: 600, capReachedAt: null })],
    ]);

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'PARTITION',
      }),
    ).resolves.toMatchObject({
      allowed: true,
      remainingCapacity: 600,
      waveSize: 600,
      currentWaveLimit: 1200,
      admittedCount: 600,
      activeEvaluationWork: 0,
    });
  });
});

describe('advancePidCapacityWave', () => {
  it('uses the observed wave edge and count as a compare-and-set guard', async () => {
    const { db, calls } = fakeDb([[{ id: 'capacity-1' }]]);

    await expect(
      advancePidCapacityWave(db, CONNECTION_ID, {
        observedLimitValue: 600,
        observedAdmittedCount: 600,
      }),
    ).resolves.toBe(true);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;

    expect(set.limitValue).toBe(1200);
    expect(set.capReachedAt).toBeNull();
  });
});

describe('countActiveEvaluationWork - historical freeze line', () => {
  const FREEZE_LINE = new Date('2026-08-12T07:53:53.888Z');

  /**
   * Whether the WHERE the repository handed to Drizzle carries this instant as
   * a bind value. Walked rather than serialised: a Drizzle SQL object holds
   * circular references, so `JSON.stringify` throws on it.
   */
  function whereBinds(
    calls: Parameters<typeof lastCallArgs>[0],
    target: Date,
  ): boolean {
    const seen = new Set<unknown>();

    const walk = (value: unknown): boolean => {
      if (value instanceof Date) return value.getTime() === target.getTime();
      if (typeof value !== 'object' || value === null) return false;
      if (seen.has(value)) return false;
      seen.add(value);

      return Object.values(value).some(walk);
    };

    return walk(lastCallArgs(calls, 'where')[0]);
  }

  it('bounds the count by the freeze line, so a wave never waits on historical work', async () => {
    const { db, calls } = fakeDb([[{ total: 4 }]]);

    await expect(
      countActiveEvaluationWork(db, CONNECTION_ID, FREEZE_LINE),
    ).resolves.toBe(4);
    expect(whereBinds(calls, FREEZE_LINE)).toBe(true);
  });

  it('counts every active row when no freeze line is given', async () => {
    const { db, calls } = fakeDb([[{ total: 4 }]]);

    await expect(countActiveEvaluationWork(db, CONNECTION_ID)).resolves.toBe(4);
    expect(whereBinds(calls, FREEZE_LINE)).toBe(false);
  });

  it('assessIntakeGate hands the gate activation instant to the wave-drain count', async () => {
    // Decision of 2026-08-12: a wave waits for the products IT admitted, never
    // for the pipeline that existed before lean intake activated.
    const activationAt = new Date('2026-08-12T07:53:53.888Z');
    const { db, calls } = fakeDb([
      [backlogGate({ activationAt })],
      [],
      [capacity()],
      allLanesExhausted(),
      [{ total: 7 }],
    ]);

    await assessIntakeGate(db, {
      supplierConnectionId: CONNECTION_ID,
      requiredCapacity: 200,
      intent: 'PARTITION',
    });

    expect(whereBinds(calls, activationAt)).toBe(true);
  });
});

describe('assessIntakeGate - strict curated intake priority', () => {
  /** Lane rows as the repository reads them, with only the fields it uses. */
  function lanes(exhausted: Record<string, number | null>) {
    return Object.entries(exhausted).map(([lane, exhaustedAtWaveLimit]) => ({
      lane,
      exhaustedAtWaveLimit,
    }));
  }

  function gateWith(laneRows: unknown[]) {
    // Backlog gate, backlog-observation write, capacity, lane rows, then the
    // active-work count the wave check would reach if priority let it.
    return fakeDb([
      [backlogGate()],
      [],
      [capacity({ admittedCount: 0 })],
      laneRows,
      [{ total: 0 }],
    ]);
  }

  it('refuses the partition scanner while any curated lane can still contribute', async () => {
    const { db } = gateWith(lanes({ CJ_TRENDING: null }));

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'PARTITION',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'HIGHER_PRIORITY_INTAKE_PENDING',
      blockedBy: 'CJ_TRENDING',
    });
  });

  it('lets the partition scanner through once every lane is exhausted for this wave', async () => {
    const { db } = gateWith(allLanesExhausted());

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'PARTITION',
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('makes a lower-priority lane wait for a higher-priority one', async () => {
    const { db } = gateWith(lanes({ CJ_TRENDING: null }));

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'CJ_MOST_LISTED',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'HIGHER_PRIORITY_INTAKE_PENDING',
      blockedBy: 'CJ_TRENDING',
    });
  });

  it('never refuses the highest-priority lane for priority', async () => {
    // CJ_TRENDING has nothing above it, so the order cannot deadlock.
    const { db } = gateWith(lanes({ CJ_TRENDING: null, CJ_MOST_LISTED: null }));

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'CJ_TRENDING',
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('treats a lane exhausted at a PREVIOUS wave edge as eligible again', async () => {
    // New products appear between waves, so exhaustion is wave-scoped.
    const { db } = gateWith(allLanesExhausted(600));

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'PARTITION',
      }),
    ).resolves.toMatchObject({ allowed: true });

    const stale = gateWith(allLanesExhausted(300));

    await expect(
      assessIntakeGate(stale.db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'PARTITION',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'HIGHER_PRIORITY_INTAKE_PENDING',
    });
  });

  it('treats a lane with no row yet as eligible, so a lane always gets its first turn', async () => {
    const { db } = gateWith([]);

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
        intent: 'PARTITION',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'HIGHER_PRIORITY_INTAKE_PENDING',
      blockedBy: 'CJ_TRENDING',
    });
  });
});

describe('tryConsumeNewPidCapacity - driver-safe binds', () => {
  /**
   * Any raw `Date` nested inside a drizzle `sql` template reaches postgres.js
   * as an untyped bind and throws ERR_INVALID_ARG_TYPE - a plain column
   * assignment is fine, because it serializes through the column's type
   * mapping. Walked recursively because the SQL object holds its params in
   * nested chunk arrays (and cycles).
   */
  function sqlChunkHoldsRawDate(
    value: unknown,
    seen = new Set<unknown>(),
  ): boolean {
    if (value instanceof Date) return true;
    if (typeof value !== 'object' || value === null) return false;
    if (seen.has(value)) return false;
    seen.add(value);

    return Object.values(value).some((inner) =>
      sqlChunkHoldsRawDate(inner, seen),
    );
  }

  it('never hands the driver a raw Date inside the cap_reached_at CASE', async () => {
    // Production 2026-08-12: the first genuinely new PID of the wave hit this
    // UPDATE, postgres.js threw on the Date bound inside the raw CASE, the
    // whole ingest transaction rolled back, and the queue redelivered forever
    // while the wave sat at 0. Fake executors never serialize binds, which is
    // why every other test passed - this one inspects the bind itself.
    const { db, calls } = fakeDb([[{ id: 'capacity-1' }]]);

    await tryConsumeNewPidCapacity(db, CONNECTION_ID);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;

    expect(sqlChunkHoldsRawDate(set.capReachedAt)).toBe(false);
    // The plain column assignments legitimately stay Dates - the column type
    // mapping serializes those - so the guard must not overreach.
    expect(set.lastAdmittedAt).toBeInstanceOf(Date);
  });
});
