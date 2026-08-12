import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/secrets/postgres-supplier-secret-store', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockClass() {
    return {};
  }),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-auth', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockClass() {
    return {};
  }),
}));

const { getCategoryTreeMock } = vi.hoisted(() => ({
  getCategoryTreeMock: vi.fn(),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-adapter', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockCjSupplierAdapter() {
    return { getCategoryTree: getCategoryTreeMock };
  }),
}));

vi.mock('@/modules/suppliers/repository', () => ({
  findConnectionById: vi.fn(),
  isWorkableConnectionStatus: (status: string) =>
    status === 'CONNECTED' || status === 'DEGRADED',
}));

vi.mock('./budget-repository', () => ({
  ensureBudgetRow: vi.fn(),
  tryAcquireRequestSlot: vi.fn(),
}));

vi.mock('./cycle-repository', () => ({
  advanceSeedCursor: vi.fn(),
  createCycleIfAbsent: vi.fn(),
  findActiveCycle: vi.fn(),
  findLatestCompletedCycle: vi.fn(),
  heartbeatCycle: vi.fn(),
  markSeedingComplete: vi.fn(),
  recordCategorySnapshotIfAbsent: vi.fn(),
}));

vi.mock('./partition-repository', () => ({
  insertPartitions: vi.fn(),
  listResumablePartitions: vi.fn(),
}));

vi.mock('./outbox-repository', () => ({ insertOutboxIntents: vi.fn() }));
vi.mock('./failure-repository', () => ({ recordDiscoveryFailure: vi.fn() }));
vi.mock('./run-state-repository', () => ({ isDiscoveryRunning: vi.fn() }));
vi.mock('./lane-repository', () => ({ findWatermark: vi.fn() }));
vi.mock('./intake-gate-repository', () => ({ findPidCapacity: vi.fn() }));
vi.mock('./curated-lane-repository', () => ({
  listEligibleCuratedLanes: vi.fn(),
}));

// eslint-disable-next-line import/first
import { randomUUID } from 'crypto';
// eslint-disable-next-line import/first
import { findConnectionById } from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import { tryAcquireRequestSlot } from './budget-repository';
// eslint-disable-next-line import/first
import {
  advanceSeedCursor,
  createCycleIfAbsent,
  findActiveCycle,
  findLatestCompletedCycle,
  markSeedingComplete,
  recordCategorySnapshotIfAbsent,
} from './cycle-repository';
// eslint-disable-next-line import/first
import {
  insertPartitions,
  listResumablePartitions,
} from './partition-repository';
// eslint-disable-next-line import/first
import { insertOutboxIntents } from './outbox-repository';
// eslint-disable-next-line import/first
import { isDiscoveryRunning } from './run-state-repository';
// eslint-disable-next-line import/first
import { findWatermark } from './lane-repository';
// eslint-disable-next-line import/first
import { findPidCapacity } from './intake-gate-repository';
// eslint-disable-next-line import/first
import { listEligibleCuratedLanes } from './curated-lane-repository';
// eslint-disable-next-line import/first
import handleCycleStart from './handle-cycle-start';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CONNECTION_ID = randomUUID();
const CYCLE_ID = randomUUID();

const MESSAGE = {
  v: 1 as const,
  operation: 'DISCOVERY_CYCLE_START' as const,
  idempotencyKey: 'cycle-start:test',
  supplierConnectionId: CONNECTION_ID,
};

function cycle(overrides: Record<string, unknown> = {}) {
  return {
    id: CYCLE_ID,
    supplierConnectionId: CONNECTION_ID,
    cycleCutoff: new Date('2026-08-11T00:00:00Z'),
    state: 'SEEDING',
    lane: 'BOOTSTRAP',
    generationKey: 'default',
    categorySnapshot: null,
    seedCursor: 0,
    partitionsTotal: 0,
    partitionsTerminal: 0,
    partitionsUnresolved: 0,
    stateVersion: 1,
    startedAt: new Date(),
    completedAt: null,
    windowFrom: null,
    safetyOverlapSeconds: null,
    proofRecordedAt: null,
    lastHeartbeatAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(findConnectionById).mockResolvedValue({
    id: CONNECTION_ID,
    status: 'CONNECTED',
  });
  asMock(isDiscoveryRunning).mockResolvedValue(true);
  asMock(tryAcquireRequestSlot).mockResolvedValue(true);
  asMock(advanceSeedCursor).mockResolvedValue(true);
  asMock(findLatestCompletedCycle).mockResolvedValue(null);
  asMock(findWatermark).mockResolvedValue(null);
  asMock(findPidCapacity).mockResolvedValue({ limitValue: 600 });
  asMock(listEligibleCuratedLanes).mockResolvedValue([
    { lane: 'CJ_TRENDING', stateVersion: 1 },
    { lane: 'CJ_MOST_LISTED', stateVersion: 1 },
    { lane: 'CJ_NEW_ARRIVALS', stateVersion: 1 },
  ]);
  asMock(insertPartitions).mockImplementation((_tx: unknown, rows: unknown[]) =>
    Promise.resolve(rows.map((_, i) => ({ id: `partition-${i}` }))),
  );
});

describe('handleCycleStart', () => {
  it('captures the category tree snapshot exactly once per cycle, then re-enters for seeding', async () => {
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle(),
      created: true,
    });
    getCategoryTreeMock.mockResolvedValue([
      { categoryId: 'cat-1', categoryName: 'Cases', path: ['Phones'] },
    ]);

    await handleCycleStart(MESSAGE);

    expect(recordCategorySnapshotIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cycleId: CYCLE_ID }),
    );
    expect(insertOutboxIntents).toHaveBeenCalled();
  });

  it('seeds root partitions in bounded batches: a pre-epoch sentinel plus the epoch-to-cutoff root per leaf', async () => {
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle({
        categorySnapshot: [
          { categoryId: 'cat-1', categoryName: 'Cases', path: [] },
          { categoryId: 'cat-2', categoryName: 'Chargers', path: [] },
        ],
      }),
      created: false,
    });

    await handleCycleStart(MESSAGE);

    const rows = asMock(insertPartitions).mock.calls[0]![1] as Array<{
      categoryId: string;
      createTimeFromMs: number | null;
    }>;

    // Two leaves x (sentinel + bounded root) = 4 partitions.
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.createTimeFromMs === null)).toHaveLength(2);
    expect(advanceSeedCursor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fromCursor: 0, toCursor: 2 }),
    );
  });

  it('after bootstrap exists, an ordinary continuation creates an incremental window from the watermark minus overlap', async () => {
    const proven = new Date('2026-08-10T00:00:00Z');
    asMock(findLatestCompletedCycle).mockResolvedValue(
      cycle({
        state: 'COMPLETE',
        completedAt: new Date(),
        cycleCutoff: proven,
      }),
    );
    asMock(findWatermark).mockResolvedValue({
      provenCutoff: proven,
      nextWindowFrom: proven,
    });
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle({
        lane: 'INCREMENTAL',
        windowFrom: new Date('2026-08-09T00:00:00Z'),
        categorySnapshot: [
          { categoryId: 'cat-1', categoryName: 'Cases', path: [] },
        ],
      }),
      created: true,
    });

    await handleCycleStart(MESSAGE);

    expect(createCycleIfAbsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        lane: 'INCREMENTAL',
        windowFrom: new Date('2026-08-09T00:00:00Z'),
      }),
    );
  });

  it('incremental seeding creates only window roots, never open-start or epoch historical roots', async () => {
    asMock(findLatestCompletedCycle).mockResolvedValue(
      cycle({ state: 'COMPLETE', completedAt: new Date() }),
    );
    asMock(findWatermark).mockResolvedValue({
      provenCutoff: new Date('2026-08-10T00:00:00Z'),
      nextWindowFrom: new Date('2026-08-10T00:00:00Z'),
    });
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle({
        lane: 'INCREMENTAL',
        windowFrom: new Date('2026-08-09T00:00:00Z'),
        categorySnapshot: [
          { categoryId: 'cat-1', categoryName: 'Cases', path: [] },
          { categoryId: 'cat-2', categoryName: 'Chargers', path: [] },
        ],
      }),
      created: false,
    });

    await handleCycleStart(MESSAGE);

    const rows = asMock(insertPartitions).mock.calls[0]![1] as Array<{
      createTimeFromMs: number | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.createTimeFromMs === null)).toBe(false);
  });

  it('marks seeding complete once the cursor passes the last leaf', async () => {
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle({
        categorySnapshot: [
          { categoryId: 'cat-1', categoryName: 'C', path: [] },
        ],
        seedCursor: 1,
      }),
      created: false,
    });

    await handleCycleStart(MESSAGE);

    expect(markSeedingComplete).toHaveBeenCalledWith(
      expect.anything(),
      CYCLE_ID,
    );
  });

  it('sweeps a RUNNING cycle: re-enqueues unleased non-terminal partitions plus its own delayed continuation - the chain heals itself without cron', async () => {
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle({ state: 'RUNNING', seedCursor: -1, categorySnapshot: [] }),
      created: false,
    });
    asMock(findActiveCycle).mockResolvedValue(
      cycle({ state: 'RUNNING', seedCursor: -1, categorySnapshot: [] }),
    );
    asMock(listResumablePartitions).mockResolvedValue([{ id: 'partition-9' }]);

    await handleCycleStart(MESSAGE);

    const intents = asMock(insertOutboxIntents).mock.calls.flatMap(
      (call) => call[1] as Array<{ message: { operation: string } }>,
    );

    expect(
      intents.some((i) => i.message.operation === 'DISCOVERY_PARTITION'),
    ).toBe(true);
    expect(
      intents.some((i) => i.message.operation === 'DISCOVERY_CYCLE_START'),
    ).toBe(true);
    expect(
      intents.some((i) => i.message.operation === 'RECONCILE_PRODUCT'),
    ).toBe(true);
  });

  it('scopes the curated seed key to the wave edge, so a lane is not capped at one run per day', async () => {
    // Outbox idempotency keys are consumed permanently. A day bucket therefore
    // allowed exactly one run per lane per day while the partition scanner ran
    // thousands of times, so the curated lanes could never fill a wave first.
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle({ state: 'RUNNING', seedCursor: -1, categorySnapshot: [] }),
      created: false,
    });
    asMock(findActiveCycle).mockResolvedValue(
      cycle({ state: 'RUNNING', seedCursor: -1, categorySnapshot: [] }),
    );
    asMock(listResumablePartitions).mockResolvedValue([]);
    asMock(findPidCapacity).mockResolvedValue({ limitValue: 1200 });
    asMock(listEligibleCuratedLanes).mockResolvedValue([
      { lane: 'CJ_TRENDING', stateVersion: 7 },
    ]);

    await handleCycleStart(MESSAGE);

    const keys = asMock(insertOutboxIntents)
      .mock.calls.flatMap(
        (call) => call[1] as Array<{ message: { idempotencyKey: string } }>,
      )
      .map((intent) => intent.message.idempotencyKey)
      .filter((key) => key.startsWith('curated:'));

    // Wave edge AND lane version. The version is what keeps the key revivable:
    // a wave-only key is spendable once per wave, so a worker that died holding
    // the lane's lease left nothing able to re-enqueue it, stranding the intake
    // floor and every producer behind it.
    expect(keys).toEqual([expect.stringContaining('CJ_TRENDING:wave:1200:v7')]);
  });

  it('re-seeds a lane on a fresh key once its state version moves, so a dead worker cannot strand the floor', async () => {
    asMock(listResumablePartitions).mockResolvedValue([]);
    asMock(findPidCapacity).mockResolvedValue({ limitValue: 600 });

    const keyFor = async (stateVersion: number) => {
      asMock(insertOutboxIntents).mockClear();
      asMock(listEligibleCuratedLanes).mockResolvedValue([
        { lane: 'CJ_TRENDING', stateVersion },
      ]);
      await handleCycleStart(MESSAGE);

      return asMock(insertOutboxIntents)
        .mock.calls.flatMap(
          (call) => call[1] as Array<{ message: { idempotencyKey: string } }>,
        )
        .map((intent) => intent.message.idempotencyKey)
        .find((key) => key.startsWith('curated:'))!;
    };

    // Same wave, same version - the same logical seed, correctly de-duplicated.
    expect(await keyFor(12)).toBe(await keyFor(12));
    // The lane moved (leased, paused, or advanced), so it is seedable again.
    expect(await keyFor(13)).not.toBe(await keyFor(12));
  });

  it('does not seed a lane that is already exhausted for this wave', async () => {
    asMock(listResumablePartitions).mockResolvedValue([]);
    asMock(listEligibleCuratedLanes).mockResolvedValue([]);

    await handleCycleStart(MESSAGE);

    const curated = asMock(insertOutboxIntents)
      .mock.calls.flatMap(
        (call) => call[1] as Array<{ message: { idempotencyKey: string } }>,
      )
      .filter((intent) => intent.message.idempotencyKey.startsWith('curated:'));

    expect(curated).toEqual([]);
  });

  it('prioritizes curated product/list lanes before partition product/list scans in each sweep', async () => {
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle({ state: 'RUNNING', seedCursor: -1, categorySnapshot: [] }),
      created: false,
    });
    asMock(findActiveCycle).mockResolvedValue(
      cycle({ state: 'RUNNING', seedCursor: -1, categorySnapshot: [] }),
    );
    asMock(listResumablePartitions).mockResolvedValue([{ id: 'partition-9' }]);

    await handleCycleStart(MESSAGE);

    const intents = asMock(insertOutboxIntents).mock.calls.flatMap(
      (call) =>
        call[1] as Array<{
          message: { operation: string; lane?: string };
        }>,
    );
    const discoveryOrder = intents
      .filter((intent) =>
        ['DISCOVERY_CURATED_LANE', 'DISCOVERY_PARTITION'].includes(
          intent.message.operation,
        ),
      )
      .map((intent) => intent.message.lane ?? intent.message.operation);

    // Array position does NOT influence claim or delivery order - only
    // `OUTBOX_CLAIM_PRIORITY` and the intake-gate arbitration do. This asserts
    // the three lanes are all seeded, in the owner's ranking, which is what
    // `CURATED_LANES` guarantees and what the gate then arbitrates on.
    expect(discoveryOrder).toEqual([
      'CJ_TRENDING',
      'CJ_MOST_LISTED',
      'CJ_NEW_ARRIVALS',
      'DISCOVERY_PARTITION',
    ]);
  });

  it('does nothing while paused - checkpoints and queue state are retained for resume', async () => {
    asMock(isDiscoveryRunning).mockResolvedValue(false);

    await handleCycleStart(MESSAGE);

    expect(createCycleIfAbsent).not.toHaveBeenCalled();
    expect(getCategoryTreeMock).not.toHaveBeenCalled();
  });

  it('acknowledges quietly when the cycle finished between deliveries (completion already chained the next cycle)', async () => {
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle({ state: 'RUNNING', seedCursor: -1, categorySnapshot: [] }),
      created: false,
    });
    asMock(findActiveCycle).mockResolvedValue(null);

    await handleCycleStart(MESSAGE);

    expect(listResumablePartitions).not.toHaveBeenCalled();
  });

  it('refuses an empty category tree as a contract anomaly instead of seeding an instantly-complete cycle', async () => {
    asMock(createCycleIfAbsent).mockResolvedValue({
      cycle: cycle(),
      created: true,
    });
    getCategoryTreeMock.mockResolvedValue([]);

    await handleCycleStart(MESSAGE);

    expect(recordCategorySnapshotIfAbsent).not.toHaveBeenCalled();
  });
});
