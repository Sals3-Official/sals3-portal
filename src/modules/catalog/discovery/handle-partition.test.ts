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

const { listCatalogPageMock } = vi.hoisted(() => ({
  listCatalogPageMock: vi.fn(),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-adapter', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockCjSupplierAdapter() {
    return { listCatalogPage: listCatalogPageMock };
  }),
}));

vi.mock('@/modules/suppliers/repository', () => ({
  findConnectionById: vi.fn(),
  isWorkableConnectionStatus: (status: string) =>
    status === 'CONNECTED' || status === 'DEGRADED',
}));

vi.mock('./budget-repository', () => ({
  assessBackgroundBudget: vi.fn(),
  tryAcquireRequestSlot: vi.fn(),
  recordPointsInfo: vi.fn(),
  recordRateLimitPause: vi.fn(),
}));

vi.mock('./partition-repository', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./partition-repository')>();

  return {
    boundsOf: original.boundsOf,
    advanceReconciliation: vi.fn(),
    clearReconcilePids: vi.fn(),
    completeReconcilePass: vi.fn(),
    countPartitionsByState: vi.fn(),
    countReconcilePids: vi.fn(),
    coverPartition: vi.fn(),
    failPartition: vi.fn(),
    findPartitionById: vi.fn(),
    insertPartitions: vi.fn(),
    insertReconcilePids: vi.fn(),
    leaseExhaustedPartition: vi.fn(),
    leasePartition: vi.fn(),
    listReconcilePids: vi.fn(),
    markPartitionUnresolved: vi.fn(),
    releasePartitionLease: vi.fn(),
    splitPartition: vi.fn(),
  };
});

vi.mock('./cycle-repository', () => ({
  findCycleById: vi.fn(),
  heartbeatCycle: vi.fn(),
  recordPartitionSplit: vi.fn(),
  recordPartitionTerminal: vi.fn(),
  tryFinishCycle: vi.fn(),
}));

vi.mock('./outbox-repository', () => ({
  insertOutboxIntents: vi.fn(),
}));

vi.mock('./failure-repository', () => ({
  recordDiscoveryFailure: vi.fn(),
}));

vi.mock('./run-state-repository', () => ({
  isDiscoveryRunning: vi.fn(),
}));

vi.mock('./storage-guard', () => ({
  default: vi.fn(),
}));

vi.mock('./ingest-product', () => ({
  default: vi.fn(),
}));

vi.mock('./handle-cycle-start', () => ({
  partitionMessageIntent: (input: {
    partitionId: string;
    keySuffix: string;
    delaySeconds?: number;
  }) => ({
    message: {
      v: 1,
      operation: 'DISCOVERY_PARTITION',
      idempotencyKey: `partition:${input.partitionId}:${input.keySuffix}`,
    },
    delaySeconds: input.delaySeconds,
  }),
  cycleStartIntent: vi.fn(),
  laneContinuationIntents: (input: { supplierConnectionId: string }) => [
    {
      message: {
        v: 1,
        operation: 'DISCOVERY_CYCLE_START',
        idempotencyKey: `cycle-start:${input.supplierConnectionId}:next`,
      },
    },
  ],
}));

vi.mock('./lane-repository', () => ({
  recordBootstrapComplete: vi.fn(),
  recordCoveredPartitionProof: vi.fn(),
  recordCycleObligation: vi.fn(),
  recordIncrementalWindowTerminal: vi.fn(),
}));

// eslint-disable-next-line import/first
import { CjApiError } from '@/services/cj/config';
// eslint-disable-next-line import/first
import { findConnectionById } from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import type { CjProduct } from '@/lib/cj/normalize';
// eslint-disable-next-line import/first
import {
  assessBackgroundBudget,
  recordRateLimitPause,
  tryAcquireRequestSlot,
} from './budget-repository';
// eslint-disable-next-line import/first
import {
  advanceReconciliation,
  completeReconcilePass,
  countPartitionsByState,
  countReconcilePids,
  coverPartition,
  failPartition,
  findPartitionById,
  insertPartitions,
  leaseExhaustedPartition,
  leasePartition,
  listReconcilePids,
  markPartitionUnresolved,
  releasePartitionLease,
  splitPartition,
} from './partition-repository';
// eslint-disable-next-line import/first
import {
  findCycleById,
  recordPartitionSplit,
  tryFinishCycle,
} from './cycle-repository';
// eslint-disable-next-line import/first
import { insertOutboxIntents } from './outbox-repository';
// eslint-disable-next-line import/first
import { recordDiscoveryFailure } from './failure-repository';
// eslint-disable-next-line import/first
import { isDiscoveryRunning } from './run-state-repository';
// eslint-disable-next-line import/first
import checkStorageGuard from './storage-guard';
// eslint-disable-next-line import/first
import ingestDiscoveredProduct from './ingest-product';
// eslint-disable-next-line import/first
import coverageChecksum from './coverage-checksum';
// eslint-disable-next-line import/first
import handlePartition from './handle-partition';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CONNECTION_ID = '5b7f9c2e-1d3a-4f6b-8c9d-0a1b2c3d4e5f';
const CYCLE_ID = '6c8f0d3f-2e4b-5a7c-9d0e-1b2c3d4e5f6a';
const PARTITION_ID = '7d9a1e4a-3f5c-6b8d-0e1f-2c3d4e5f6a7b';

const MESSAGE = {
  v: 1 as const,
  operation: 'DISCOVERY_PARTITION' as const,
  idempotencyKey: 'partition:x:initial',
  supplierConnectionId: CONNECTION_ID,
  cycleId: CYCLE_ID,
  partitionId: PARTITION_ID,
};

function product(id: string): CjProduct {
  return {
    id,
    name: 'Plain phone case',
    sku: `SKU-${id}`,
    imageUrl: null,
    category: 'Phone accessories',
    priceCentsUsd: 500,
    weight: '100 g',
    productType: 'accessory',
    supplier: 'CJ',
    freeShipping: false,
    shipsFrom: ['CN'],
    listedCount: 10,
    createdAt: null,
  };
}

function catalogPage(
  products: CjProduct[],
  overrides: Record<string, unknown> = {},
) {
  const total = (overrides.total as number) ?? products.length;

  return {
    products,
    requestedPageNum: 1,
    pageNum: 1,
    pageSize: 200,
    total,
    totalPages: Math.max(1, Math.ceil(total / 200)),
    pointsInfo: { total: 50_000, usedToday: 100, remaining: 49_900 },
    ...overrides,
  };
}

function partitionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTITION_ID,
    cycleId: CYCLE_ID,
    supplierConnectionId: CONNECTION_ID,
    parentPartitionId: null,
    depth: 0,
    categoryId: 'cat-1',
    createTimeFromMs: 1_600_000_000_000,
    createTimeToMs: 1_700_000_000_000,
    priceFromCents: null,
    priceToCents: null,
    state: 'PENDING',
    attempts: 0,
    lastErrorCode: null,
    reportedTotal: null,
    uniquePidCount: null,
    passChecksums: [] as string[],
    reconcilePass: null,
    reconcileNextPage: null,
    reconcileAttempts: 0,
    unresolvedReason: null,
    leaseToken: null,
    leasedUntil: null,
    stateVersion: 1,
    coveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const CONNECTION = {
  id: CONNECTION_ID,
  sellerAccountId: 'seller-1',
  status: 'CONNECTED',
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(findConnectionById).mockResolvedValue(CONNECTION);
  asMock(isDiscoveryRunning).mockResolvedValue(true);
  asMock(checkStorageGuard).mockResolvedValue({
    usedBytes: 0,
    allowanceBytes: 1,
    usedPercent: 1,
    warn: false,
    pauseBroadDiscovery: false,
  });
  asMock(assessBackgroundBudget).mockResolvedValue({ allowed: true });
  asMock(tryAcquireRequestSlot).mockResolvedValue(true);
  asMock(coverPartition).mockResolvedValue(true);
  asMock(splitPartition).mockResolvedValue(true);
  asMock(markPartitionUnresolved).mockResolvedValue(true);
  asMock(failPartition).mockResolvedValue(true);
  asMock(advanceReconciliation).mockResolvedValue(true);
  asMock(completeReconcilePass).mockResolvedValue(true);
  asMock(countPartitionsByState).mockResolvedValue({});
  asMock(findCycleById).mockResolvedValue({
    id: CYCLE_ID,
    supplierConnectionId: CONNECTION_ID,
    lane: 'BOOTSTRAP',
    generationKey: 'default',
    cycleCutoff: new Date('2026-08-11T00:00:00Z'),
    windowFrom: null,
    state: 'COMPLETE',
  });
  asMock(tryFinishCycle).mockResolvedValue('STILL_RUNNING');
  asMock(insertPartitions).mockResolvedValue([
    { id: 'child-1' },
    { id: 'child-2' },
  ]);
  asMock(ingestDiscoveredProduct).mockResolvedValue('created');
});

describe('handlePartition - probe outcomes', () => {
  it('proves coverage for a single-page partition: ingest all, unique PIDs == total, COVERED', async () => {
    const row = partitionRow();

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    listCatalogPageMock.mockResolvedValue(
      catalogPage([product('p1'), product('p2')]),
    );

    await handlePartition(MESSAGE);

    expect(ingestDiscoveredProduct).toHaveBeenCalledTimes(2);
    expect(coverPartition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        partitionId: PARTITION_ID,
        reportedTotal: 2,
        uniquePidCount: 2,
      }),
    );
  });

  it('marks only that partition covered on total=0, ingesting nothing', async () => {
    const row = partitionRow();

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    listCatalogPageMock.mockResolvedValue(catalogPage([], { total: 0 }));

    await handlePartition(MESSAGE);

    expect(ingestDiscoveredProduct).not.toHaveBeenCalled();
    expect(coverPartition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reportedTotal: 0, uniquePidCount: 0 }),
    );
  });

  it('splits a dense partition into two children and enqueues both - a legacy total over 6,000 is ordinary density', async () => {
    const row = partitionRow();

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    listCatalogPageMock.mockResolvedValue(
      catalogPage(
        Array.from({ length: 200 }, (_, i) => product(`p${i}`)),
        { total: 50_000, totalPages: 250 },
      ),
    );

    await handlePartition(MESSAGE);

    expect(splitPartition).toHaveBeenCalled();
    expect(insertPartitions).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ parentPartitionId: PARTITION_ID, depth: 1 }),
      ]),
    );
    expect(recordPartitionSplit).toHaveBeenCalledWith(expect.anything(), {
      cycleId: CYCLE_ID,
      childrenAdded: 2,
    });
    // The V2 cap does not exist here: no unresolved/failed path was taken.
    expect(markPartitionUnresolved).not.toHaveBeenCalled();
    expect(failPartition).not.toHaveBeenCalled();
  });

  it('rejects an invalid page fail-closed: nothing ingests, no coverage, lease released, retry enqueued, failure recorded', async () => {
    const row = partitionRow();

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    // Returned page identity differs from the requested page.
    listCatalogPageMock.mockResolvedValue(
      catalogPage([product('p1')], { pageNum: 7, total: 1 }),
    );

    await handlePartition(MESSAGE);

    expect(ingestDiscoveredProduct).not.toHaveBeenCalled();
    expect(coverPartition).not.toHaveBeenCalled();
    expect(splitPartition).not.toHaveBeenCalled();
    expect(releasePartitionLease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'PROVIDER_PAGE_IDENTITY_MISMATCH',
      }),
    );
    expect(recordDiscoveryFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'PROVIDER_PAGE_IDENTITY_MISMATCH' }),
    );
    expect(insertOutboxIntents).toHaveBeenCalled();
  });

  it('acknowledges a duplicate/out-of-order delivery for a terminal partition without leasing', async () => {
    asMock(findPartitionById).mockResolvedValue(
      partitionRow({ state: 'COVERED' }),
    );

    await handlePartition(MESSAGE);

    expect(leasePartition).not.toHaveBeenCalled();
    expect(listCatalogPageMock).not.toHaveBeenCalled();
  });

  it('performs no supplier work while paused, retaining all state', async () => {
    asMock(isDiscoveryRunning).mockResolvedValue(false);

    await handlePartition(MESSAGE);

    expect(findPartitionById).not.toHaveBeenCalled();
    expect(listCatalogPageMock).not.toHaveBeenCalled();
  });

  it('parks with a delayed continuation when the points budget refuses - never spends the reserve', async () => {
    const row = partitionRow();

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    asMock(assessBackgroundBudget).mockResolvedValue({
      allowed: false,
      reason: 'POINTS_RESERVE',
      retryAt: new Date(Date.now() + 60_000),
    });

    await handlePartition(MESSAGE);

    expect(listCatalogPageMock).not.toHaveBeenCalled();
    expect(releasePartitionLease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'BUDGET_POINTS_RESERVE',
        consumeAttempt: false,
      }),
    );
    expect(insertOutboxIntents).toHaveBeenCalled();
  });

  it('parks without consuming a partition attempt when the shared request slot is busy', async () => {
    const row = partitionRow({ attempts: 3 });

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    asMock(tryAcquireRequestSlot).mockResolvedValue(false);

    await handlePartition(MESSAGE);

    expect(listCatalogPageMock).not.toHaveBeenCalled();
    expect(releasePartitionLease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'RATE_SLOT_UNAVAILABLE',
        consumeAttempt: false,
      }),
    );
    expect(insertOutboxIntents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          delaySeconds: 10,
          message: expect.objectContaining({
            operation: 'DISCOVERY_PARTITION',
          }),
        }),
      ]),
    );
  });

  it('handles HTTP 429 by pausing the budget and scheduling a delayed continuation - no aggressive retry', async () => {
    const row = partitionRow();

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    listCatalogPageMock.mockRejectedValue(new CjApiError('rate-limited'));

    await handlePartition(MESSAGE);

    expect(recordRateLimitPause).toHaveBeenCalled();
    expect(releasePartitionLease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'PROVIDER_RATE_LIMITED',
        consumeAttempt: false,
      }),
    );
  });

  it('pauses new broad discovery when the storage guard trips', async () => {
    asMock(checkStorageGuard).mockResolvedValue({
      usedBytes: 999,
      allowanceBytes: 1000,
      usedPercent: 99,
      warn: true,
      pauseBroadDiscovery: true,
    });

    await handlePartition(MESSAGE);

    expect(leasePartition).not.toHaveBeenCalled();
    expect(recordDiscoveryFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'STORAGE_GUARD_PAUSED' }),
    );
  });

  it('surfaces an attempts-exhausted partition as FAILED instead of letting it vanish', async () => {
    const row = partitionRow({ attempts: 5 });

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue(null);
    asMock(leaseExhaustedPartition).mockResolvedValue({
      row,
      leaseToken: 'fail-lease',
    });

    await handlePartition(MESSAGE);

    expect(failPartition).toHaveBeenCalled();
  });
});

describe('handlePartition - atomic bucket reconciliation', () => {
  const checksumFor = (pids: string[], row: ReturnType<typeof partitionRow>) =>
    coverageChecksum({
      partitionId: row.id,
      categoryId: row.categoryId,
      timeFromMs: row.createTimeFromMs as number | null,
      timeToMs: row.createTimeToMs as number,
      priceFromCents: row.priceFromCents as number | null,
      priceToCents: row.priceToCents as number | null,
      uniquePids: pids,
    });

  it('transitions a minimum-bucket dense partition to RECONCILING with a successor message', async () => {
    // Minimum time interval and minimum price interval: nothing can split.
    const row = partitionRow({
      createTimeFromMs: 1_600_000_000_000,
      createTimeToMs: 1_600_000_001_000,
      priceFromCents: 100,
      priceToCents: 101,
    });

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    listCatalogPageMock.mockResolvedValue(
      catalogPage(
        Array.from({ length: 200 }, (_, i) => product(`p${i}`)),
        { total: 300, totalPages: 2 },
      ),
    );

    await handlePartition(MESSAGE);

    expect(advanceReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reconcilePass: 1, reconcileNextPage: 1 }),
    );
    expect(insertOutboxIntents).toHaveBeenCalled();
    expect(coverPartition).not.toHaveBeenCalled();
  });

  it('proves stable coverage after two consecutive identical complete passes with count == total', async () => {
    const pids = ['pa', 'pb', 'pc'];
    const rowBase = partitionRow({
      state: 'RECONCILING',
      reconcilePass: 2,
      reconcileNextPage: 1,
      reportedTotal: 3,
      reconcileAttempts: 1,
    });
    const pass1Checksum = checksumFor(pids, rowBase);
    const row = { ...rowBase, passChecksums: [pass1Checksum] };

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    listCatalogPageMock.mockResolvedValue(
      catalogPage(pids.map(product), { total: 3, totalPages: 1 }),
    );
    asMock(listReconcilePids).mockResolvedValue(pids);
    asMock(countReconcilePids).mockResolvedValue(3);

    await handlePartition(MESSAGE);

    expect(coverPartition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reportedTotal: 3,
        uniquePidCount: 3,
        passChecksums: [pass1Checksum, pass1Checksum],
      }),
    );
  });

  it('keeps a non-converging bucket visibly unresolved after bounded retries - never a false completeness claim', async () => {
    const pids = ['pa', 'pb'];
    const rowBase = partitionRow({
      state: 'RECONCILING',
      reconcilePass: 4,
      reconcileNextPage: 1,
      reportedTotal: 2,
      reconcileAttempts: 3,
    });
    // Three prior passes, none consecutive-identical with this one.
    const row = {
      ...rowBase,
      passChecksums: ['c1', 'c2', 'c3'],
    };

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    listCatalogPageMock.mockResolvedValue(
      catalogPage(pids.map(product), { total: 2, totalPages: 1 }),
    );
    asMock(listReconcilePids).mockResolvedValue(pids);
    asMock(countReconcilePids).mockResolvedValue(2);

    await handlePartition(MESSAGE);

    expect(markPartitionUnresolved).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ partitionId: PARTITION_ID }),
    );
    expect(coverPartition).not.toHaveBeenCalled();
  });

  it('refuses coverage when checksums agree but the unique count differs from the reported total', async () => {
    const pids = ['pa', 'pb', 'pc'];
    const rowBase = partitionRow({
      state: 'RECONCILING',
      reconcilePass: 2,
      reconcileNextPage: 1,
      reportedTotal: 4,
      reconcileAttempts: 3,
    });
    const pass1Checksum = checksumFor(pids, rowBase);
    const row = { ...rowBase, passChecksums: [pass1Checksum] };

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    listCatalogPageMock.mockResolvedValue(
      catalogPage(pids.map(product), { total: 4, totalPages: 1 }),
    );
    asMock(listReconcilePids).mockResolvedValue(pids);
    asMock(countReconcilePids).mockResolvedValue(3);

    await handlePartition(MESSAGE);

    expect(coverPartition).not.toHaveBeenCalled();
    expect(recordDiscoveryFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'RECONCILE_COUNT_MISMATCH' }),
    );
    // Attempts were exhausted by this pass, so it lands unresolved.
    expect(markPartitionUnresolved).toHaveBeenCalled();
  });

  it('enqueues the next cycle when the last partition completes the cycle', async () => {
    const row = partitionRow();

    asMock(findPartitionById).mockResolvedValue(row);
    asMock(leasePartition).mockResolvedValue({ row, leaseToken: 'lease-1' });
    asMock(tryFinishCycle).mockResolvedValue('COMPLETE');
    listCatalogPageMock.mockResolvedValue(catalogPage([], { total: 0 }));

    await handlePartition(MESSAGE);

    expect(insertOutboxIntents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.objectContaining({
            operation: 'DISCOVERY_CYCLE_START',
          }),
        }),
      ]),
    );
  });
});
