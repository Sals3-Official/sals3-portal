import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/suppliers/repository', () => ({
  listWorkableConnections: vi.fn(),
}));

vi.mock('./run-state-repository', () => ({ setDesiredRunState: vi.fn() }));
vi.mock('./cycle-repository', () => ({
  createCycleIfAbsent: vi.fn(),
  findActiveCycle: vi.fn(),
  findLatestCompletedCycle: vi.fn(),
}));
vi.mock('./budget-repository', () => ({ ensureBudgetRow: vi.fn() }));
vi.mock('./outbox-repository', () => ({ insertOutboxIntents: vi.fn() }));
vi.mock('./outbox-dispatch', () => ({ default: vi.fn() }));
vi.mock('./lane-repository', () => ({ findWatermark: vi.fn() }));
vi.mock('./handle-cycle-start', () => ({
  cycleStartIntent: (input: { keySuffix: string; lane?: string }) => ({
    message: {
      v: 1,
      operation: 'DISCOVERY_CYCLE_START',
      idempotencyKey: `cycle-start:${input.keySuffix}`,
      lane: input.lane,
    },
  }),
}));

// eslint-disable-next-line import/first
import { listWorkableConnections } from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import { setDesiredRunState } from './run-state-repository';
// eslint-disable-next-line import/first
import {
  createCycleIfAbsent,
  findActiveCycle,
  findLatestCompletedCycle,
} from './cycle-repository';
// eslint-disable-next-line import/first
import dispatchOutbox from './outbox-dispatch';
// eslint-disable-next-line import/first
import { findWatermark } from './lane-repository';
// eslint-disable-next-line import/first
import applyDiscoveryControl from './control';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CYCLE = { id: 'cycle-1' };

beforeEach(() => {
  vi.clearAllMocks();
  asMock(listWorkableConnections).mockResolvedValue([
    { id: 'connection-1', status: 'CONNECTED' },
  ]);
  asMock(createCycleIfAbsent).mockResolvedValue({
    cycle: CYCLE,
    created: false,
  });
  asMock(findActiveCycle).mockResolvedValue(CYCLE);
  asMock(findLatestCompletedCycle).mockResolvedValue(null);
  asMock(findWatermark).mockResolvedValue(null);
  asMock(dispatchOutbox).mockResolvedValue({ dispatched: 1, failed: 0 });
});

describe('applyDiscoveryControl', () => {
  it('START sets the run state, ensures one cycle, enqueues the chain kick, and drains the outbox', async () => {
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: CYCLE,
      created: true,
    });

    const results = await applyDiscoveryControl({ action: 'START' });

    expect(results).toEqual([
      expect.objectContaining({
        action: 'START',
        runState: 'RUNNING',
        cycleId: 'cycle-1',
        cycleCreated: true,
        chainDispatched: true,
      }),
    ]);
    expect(setDesiredRunState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ desiredState: 'RUNNING', action: 'START' }),
    );
    expect(dispatchOutbox).toHaveBeenCalled();
  });

  it('START is idempotent: a second call converges on the same already-active chain', async () => {
    const results = await applyDiscoveryControl({ action: 'START' });

    expect(results[0]).toEqual(
      expect.objectContaining({ cycleId: 'cycle-1', cycleCreated: false }),
    );
  });

  it('START chooses incremental recovery when bootstrap already completed', async () => {
    const proven = new Date('2026-08-10T00:00:00Z');
    asMock(findLatestCompletedCycle).mockResolvedValue({
      id: 'bootstrap-cycle',
      cycleCutoff: proven,
    });
    asMock(findWatermark).mockResolvedValue({
      provenCutoff: proven,
      nextWindowFrom: proven,
    });

    await applyDiscoveryControl({ action: 'START' });

    expect(createCycleIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lane: 'INCREMENTAL' }),
    );
  });

  it('two concurrent starts cannot create two active chains - createCycleIfAbsent is the single arbiter both calls flow through', async () => {
    await Promise.all([
      applyDiscoveryControl({ action: 'START' }),
      applyDiscoveryControl({ action: 'START' }),
    ]);

    // Both invocations delegated chain creation to the DB-guarded
    // create-if-absent (whose partial unique index makes the race safe).
    expect(createCycleIfAbsent).toHaveBeenCalledTimes(2);
    asMock(createCycleIfAbsent).mock.calls.forEach((call) => {
      expect(call[1]).toEqual(
        expect.objectContaining({ supplierConnectionId: 'connection-1' }),
      );
    });
  });

  it('reports chainDispatched=false when the kick-off publish failed - no queue delivery exists yet to drain it later', async () => {
    asMock(dispatchOutbox).mockResolvedValue({ dispatched: 0, failed: 1 });

    const results = await applyDiscoveryControl({ action: 'START' });

    expect(results[0]).toEqual(
      expect.objectContaining({ chainDispatched: false }),
    );
  });

  it('PAUSE flips only the run state and never spawns queue work', async () => {
    const results = await applyDiscoveryControl({ action: 'PAUSE' });

    expect(results[0]).toEqual(
      expect.objectContaining({ action: 'PAUSE', runState: 'PAUSED' }),
    );
    expect(createCycleIfAbsent).not.toHaveBeenCalled();
    expect(dispatchOutbox).not.toHaveBeenCalled();
  });

  it('RESUME re-kicks the ensure-and-sweep chain so parked work is re-enqueued', async () => {
    const results = await applyDiscoveryControl({ action: 'RESUME' });

    expect(results[0]).toEqual(
      expect.objectContaining({ action: 'RESUME', runState: 'RUNNING' }),
    );
    expect(dispatchOutbox).toHaveBeenCalled();
  });

  it('scopes to one connection when asked', async () => {
    asMock(listWorkableConnections).mockResolvedValue([
      { id: 'connection-1' },
      { id: 'connection-2' },
    ]);

    const results = await applyDiscoveryControl({
      action: 'START',
      supplierConnectionId: 'connection-2',
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.supplierConnectionId).toBe('connection-2');
  });
});
