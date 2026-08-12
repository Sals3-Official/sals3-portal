import { describe, expect, it } from 'vitest';
import { fakeDb, lastCallArgs } from '../../../../test/fake-db';
import {
  advancePidCapacityWave,
  assessIntakeGate,
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

describe('assessIntakeGate - rolling new-PID waves', () => {
  it('blocks supplier calls at the wave edge while active pipeline work remains', async () => {
    const { db } = fakeDb([[backlogGate()], [], [capacity()], [{ total: 9 }]]);

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
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
      [{ total: 0 }],
      [{ id: 'capacity-1' }],
      [capacity({ limitValue: 1200, admittedCount: 600, capReachedAt: null })],
    ]);

    await expect(
      assessIntakeGate(db, {
        supplierConnectionId: CONNECTION_ID,
        requiredCapacity: 200,
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
