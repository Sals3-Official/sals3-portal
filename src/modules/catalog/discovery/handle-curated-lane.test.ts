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

const { listCuratedPageMock, listCatalogPageMock } = vi.hoisted(() => ({
  listCuratedPageMock: vi.fn(),
  listCatalogPageMock: vi.fn(),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-adapter', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockCjSupplierAdapter() {
    return {
      listCuratedPage: listCuratedPageMock,
      listCatalogPage: listCatalogPageMock,
    };
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

vi.mock('./curated-lane-repository', () => ({
  advanceCuratedLane: vi.fn(),
  ensureCuratedLanes: vi.fn(),
  leaseCuratedLane: vi.fn(),
  pauseCuratedLane: vi.fn(),
}));

vi.mock('./intake-gate-repository', () => ({
  assessIntakeGate: vi.fn(),
}));

vi.mock('./backlog-drain', () => ({ default: vi.fn() }));
vi.mock('./ingest-product', () => ({ default: vi.fn() }));
vi.mock('./outbox-repository', () => ({ insertOutboxIntents: vi.fn() }));
vi.mock('./failure-repository', () => ({ recordDiscoveryFailure: vi.fn() }));
vi.mock('./run-state-repository', () => ({ isDiscoveryRunning: vi.fn() }));
vi.mock('./storage-guard', () => ({ default: vi.fn() }));

// eslint-disable-next-line import/first
import { findConnectionById } from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import type { CjProduct } from '@/lib/cj/normalize';
// eslint-disable-next-line import/first
import {
  assessBackgroundBudget,
  tryAcquireRequestSlot,
} from './budget-repository';
// eslint-disable-next-line import/first
import {
  advanceCuratedLane,
  leaseCuratedLane,
  pauseCuratedLane,
} from './curated-lane-repository';
// eslint-disable-next-line import/first
import { assessIntakeGate } from './intake-gate-repository';
// eslint-disable-next-line import/first
import drainExistingBacklog from './backlog-drain';
// eslint-disable-next-line import/first
import ingestDiscoveredProduct from './ingest-product';
// eslint-disable-next-line import/first
import { recordDiscoveryFailure } from './failure-repository';
// eslint-disable-next-line import/first
import { isDiscoveryRunning } from './run-state-repository';
// eslint-disable-next-line import/first
import checkStorageGuard from './storage-guard';
// eslint-disable-next-line import/first
import handleCuratedLane from './handle-curated-lane';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CONNECTION_ID = '5b7f9c2e-1d3a-4f6b-8c9d-0a1b2c3d4e5f';

const CONNECTION = {
  id: CONNECTION_ID,
  sellerAccountId: 'seller-1',
  status: 'CONNECTED',
};

function product(id: string, listedCount: number | null = 900): CjProduct {
  return {
    id,
    name: 'Plain phone case',
    sku: `SKU-${id}`,
    imageUrl: null,
    category: 'Phone accessories',
    categoryId: 'cat-1',
    priceCentsUsd: 500,
    weight: '100 g',
    productType: 'accessory',
    supplier: 'CJ',
    freeShipping: false,
    shipsFrom: ['CN'],
    listedCount,
    createdAt: null,
  };
}

function laneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lane-1',
    supplierConnectionId: CONNECTION_ID,
    lane: 'CJ_TRENDING',
    state: 'IDLE',
    nextPage: 1,
    pagesFetched: 0,
    windowFromMs: null,
    windowToMs: null,
    newPidsAdmitted: 0,
    signalsRecorded: 0,
    lastPauseReason: null,
    lastErrorCode: null,
    attempts: 0,
    leaseToken: null,
    leasedUntil: null,
    stateVersion: 1,
    lastRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function curatedPage(products: CjProduct[], total = products.length) {
  return {
    products,
    requestedPageNum: 1,
    pageNum: 1,
    pageSize: 100,
    total,
    totalPages: Math.max(1, Math.ceil(total / 100)),
    pointsInfo: { total: 50_000, usedToday: 100, remaining: 49_900 },
  };
}

function message(lane: 'CJ_TRENDING' | 'CJ_MOST_LISTED' | 'CJ_NEW_ARRIVALS') {
  return {
    v: 1 as const,
    operation: 'DISCOVERY_CURATED_LANE' as const,
    idempotencyKey: `curated:${CONNECTION_ID}:${lane}:test`,
    supplierConnectionId: CONNECTION_ID,
    lane,
  };
}

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
  asMock(assessIntakeGate).mockResolvedValue({
    allowed: true,
    remainingCapacity: 5_000,
  });
  asMock(ingestDiscoveredProduct).mockResolvedValue('created');
  asMock(advanceCuratedLane).mockResolvedValue(true);
  asMock(leaseCuratedLane).mockResolvedValue({
    row: laneRow(),
    leaseToken: 'lease-1',
  });
  listCuratedPageMock.mockResolvedValue(curatedPage([product('p1')]));
});

describe('handleCuratedLane', () => {
  it('uses only the legacy product/list curated read - never listV2 or a catalogue page', async () => {
    await handleCuratedLane(message('CJ_TRENDING'));

    expect(listCuratedPageMock).toHaveBeenCalled();
    expect(listCatalogPageMock).not.toHaveBeenCalled();
  });

  it('sends the owner-specified CJ Trending selector', async () => {
    await handleCuratedLane(message('CJ_TRENDING'));

    expect(listCuratedPageMock).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.objectContaining({ searchType: 2 }),
    );
  });

  it('orders Most listed by listedNum with a fixed descending sort', async () => {
    asMock(leaseCuratedLane).mockResolvedValue({
      row: laneRow({ lane: 'CJ_MOST_LISTED' }),
      leaseToken: 'lease-1',
    });

    await handleCuratedLane(message('CJ_MOST_LISTED'));

    expect(listCuratedPageMock).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.objectContaining({ orderBy: 'listedNum', sort: 'desc' }),
    );
  });

  it('bounds New arrivals with a deterministic sort and an explicit time interval', async () => {
    asMock(leaseCuratedLane).mockResolvedValue({
      row: laneRow({ lane: 'CJ_NEW_ARRIVALS' }),
      leaseToken: 'lease-1',
    });

    await handleCuratedLane(message('CJ_NEW_ARRIVALS'));

    const [, query] = listCuratedPageMock.mock.calls[0];

    expect(query.orderBy).toBe('createAt');
    expect(query.sort).toBe('desc');
    expect(typeof query.createTimeFrom).toBe('string');
    expect(typeof query.createTimeTo).toBe('string');
  });

  it('waits behind the one-time backlog drain before any curated supplier call', async () => {
    asMock(assessIntakeGate).mockResolvedValue({
      allowed: false,
      reason: 'BACKLOG_DRAIN_PENDING',
      backlogCount: 7,
      remainingCapacity: 5_000,
      limitValue: 5_000,
      admittedCount: 0,
    });

    await handleCuratedLane(message('CJ_TRENDING'));

    expect(listCuratedPageMock).not.toHaveBeenCalled();
    expect(drainExistingBacklog).toHaveBeenCalledWith(CONNECTION_ID);
    expect(pauseCuratedLane).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'BACKLOG_DRAIN_PENDING' }),
    );
    // A pause never advances the resumable cursor.
    expect(advanceCuratedLane).not.toHaveBeenCalled();
  });

  it('shares the same new-PID ledger and stops calling CJ once the ceiling is reached', async () => {
    asMock(assessIntakeGate).mockResolvedValue({
      allowed: false,
      reason: 'NEW_PID_CAP_REACHED',
      backlogCount: 0,
      remainingCapacity: 3,
      limitValue: 5_000,
      admittedCount: 4_997,
    });

    await handleCuratedLane(message('CJ_TRENDING'));

    expect(listCuratedPageMock).not.toHaveBeenCalled();
    expect(recordDiscoveryFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'NEW_PID_CAP_REACHED' }),
    );
    expect(advanceCuratedLane).not.toHaveBeenCalled();
  });

  it('parks at its cursor when the ceiling is reached mid-page', async () => {
    listCuratedPageMock.mockResolvedValue(
      curatedPage([product('p1'), product('p2')]),
    );
    asMock(ingestDiscoveredProduct)
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('cap-reached');

    await handleCuratedLane(message('CJ_TRENDING'));

    expect(pauseCuratedLane).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'NEW_PID_CAP_REACHED' }),
    );
    expect(advanceCuratedLane).not.toHaveBeenCalled();
  });

  it('attaches the trending signal to every observed product', async () => {
    await handleCuratedLane(message('CJ_TRENDING'));

    expect(ingestDiscoveredProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      CONNECTION,
      expect.objectContaining({
        cycleId: null,
        partitionId: null,
        signals: [
          expect.objectContaining({
            signal: 'CJ_TRENDING',
            sourceLane: 'CJ_TRENDING',
          }),
        ],
      }),
    );
  });

  it('grants High listed only above the configured listedNum threshold', async () => {
    asMock(leaseCuratedLane).mockResolvedValue({
      row: laneRow({ lane: 'CJ_MOST_LISTED' }),
      leaseToken: 'lease-1',
    });
    listCuratedPageMock.mockResolvedValue(curatedPage([product('p-low', 1)]));

    await handleCuratedLane(message('CJ_MOST_LISTED'));

    expect(ingestDiscoveredProduct).toHaveBeenCalledWith(
      expect.anything(),
      CONNECTION,
      expect.objectContaining({ signals: [] }),
    );
  });

  it('does nothing when another worker already holds the lane lease', async () => {
    asMock(leaseCuratedLane).mockResolvedValue(null);

    await handleCuratedLane(message('CJ_TRENDING'));

    expect(listCuratedPageMock).not.toHaveBeenCalled();
    expect(ingestDiscoveredProduct).not.toHaveBeenCalled();
  });

  it('makes no supplier call while discovery is paused', async () => {
    asMock(isDiscoveryRunning).mockResolvedValue(false);

    await handleCuratedLane(message('CJ_TRENDING'));

    expect(listCuratedPageMock).not.toHaveBeenCalled();
  });
});
