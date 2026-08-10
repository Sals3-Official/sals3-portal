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
    categorySnapshot: null,
    seedCursor: 0,
    partitionsTotal: 0,
    partitionsTerminal: 0,
    partitionsUnresolved: 0,
    stateVersion: 1,
    startedAt: new Date(),
    completedAt: null,
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
