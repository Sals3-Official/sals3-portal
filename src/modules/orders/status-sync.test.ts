// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsOf, fakeDb } from '../../../test/fake-db';

vi.mock('server-only', () => ({}));

const { fetchMock, dbState } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  dbState: { db: null as unknown },
}));

vi.mock('@/lib/db/client', () => ({
  default: () => dbState.db,
}));

vi.mock('@/lib/secrets/postgres-supplier-secret-store', () => ({
  default: function PostgresSupplierSecretStore() {},
}));

vi.mock('@/modules/suppliers/providers/cj/cj-auth', () => ({
  default: function CjTokenManager() {
    return { getAccessToken: async () => 'cj-token' };
  },
}));

vi.mock('@/modules/catalog/discovery/governed-fetch', () => ({
  default: () => fetchMock,
}));

const { default: runOrderStatusSync } = await import('./status-sync');

const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: GROUP_ID,
    orderId: '11111111-1111-4111-8111-111111111111',
    packageId: 'pkg_1',
    supplierConnectionId: CONNECTION_ID,
    originCountry: 'CN',
    destinationCountry: 'PH',
    logisticName: 'CJPacket Ordinary',
    optionId: 'option-1',
    channelId: 'channel-1',
    shippingAmountMinor: BigInt(500),
    currency: 'USD',
    status: 'CJ_PAID',
    cjOrderId: 'CJ123',
    cjShipmentOrderId: null,
    cjPayId: null,
    lastErrorCode: null,
    parcelState: null,
    trackingNumber: null,
    supplierStatusRaw: null,
    carrierDeliveredAt: null,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function cjResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, result: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('runOrderStatusSync', () => {
  it('translates CJ status through the state machine and persists tracking', async () => {
    // Statements awaited in order: due-groups select, event insert, update.
    const { db, calls } = fakeDb([[group()], [{ id: 'evt-1' }], []]);
    dbState.db = db;

    fetchMock
      .mockResolvedValueOnce(
        cjResponse({
          orderStatus: 'SHIPPED',
          orderSubStatus: null,
          trackNumber: 'CJP001',
        }),
      )
      .mockResolvedValueOnce(
        cjResponse([
          {
            trackingStatus: 'IN_TRANSIT',
            content: 'Departed sorting facility',
            date: '2026-08-18 10:00:00',
          },
        ]),
      );

    const result = await runOrderStatusSync();

    expect(result).toEqual({
      scanned: 1,
      updated: 1,
      eventsInserted: 1,
      failed: 0,
    });

    const [setArgs] = callsOf(calls, 'set').at(-1)!.args as [
      Record<string, unknown>,
    ];

    expect(setArgs.parcelState).toBe('SHIPPED');
    expect(setArgs.trackingNumber).toBe('CJP001');
    expect(setArgs.supplierStatusRaw).toBe('SHIPPED');
    expect(setArgs.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('holds TRACKING_CONFLICT when the carrier says delivered and CJ does not', async () => {
    const { db, calls } = fakeDb([
      [group({ trackingNumber: 'CJP001' })],
      [{ id: 'evt-1' }],
      [],
    ]);
    dbState.db = db;

    fetchMock
      .mockResolvedValueOnce(
        cjResponse({
          orderStatus: 'SHIPPED',
          orderSubStatus: null,
          trackNumber: 'CJP001',
        }),
      )
      .mockResolvedValueOnce(
        cjResponse([
          {
            trackingStatus: 'DELIVERED',
            content: 'Delivered to recipient',
            date: '2026-08-18 12:00:00',
          },
        ]),
      );

    await runOrderStatusSync();

    const [setArgs] = callsOf(calls, 'set').at(-1)!.args as [
      Record<string, unknown>,
    ];

    // ADR-004 §5: disagreement conflicts; it never resolves itself.
    expect(setArgs.parcelState).toBe('TRACKING_CONFLICT');
    expect(setArgs.carrierDeliveredAt).toBeInstanceOf(Date);
  });

  it('lets DELIVERED agree with the carrier', async () => {
    const { db, calls } = fakeDb([
      [group({ trackingNumber: 'CJP001' })],
      [{ id: 'evt-1' }],
      [],
    ]);
    dbState.db = db;

    fetchMock
      .mockResolvedValueOnce(
        cjResponse({ orderStatus: 'DELIVERED', trackNumber: 'CJP001' }),
      )
      .mockResolvedValueOnce(
        cjResponse([
          {
            trackingStatus: 'DELIVERED',
            content: 'Delivered',
            date: '2026-08-18 12:00:00',
          },
        ]),
      );

    await runOrderStatusSync();

    const [setArgs] = callsOf(calls, 'set').at(-1)!.args as [
      Record<string, unknown>,
    ];

    expect(setArgs.parcelState).toBe('DELIVERED');
  });

  it('counts a failing group and keeps its lastSyncedAt untouched', async () => {
    const { db, calls } = fakeDb([[group()]]);
    dbState.db = db;

    fetchMock.mockResolvedValue(
      new Response('{}', { status: 500, headers: {} }),
    );

    const result = await runOrderStatusSync();

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });

  it('keeps the order detail when the track feed fails', async () => {
    const { db, calls } = fakeDb([[group()], []]);
    dbState.db = db;

    fetchMock
      .mockResolvedValueOnce(
        cjResponse({ orderStatus: 'SHIPPED', trackNumber: 'CJP002' }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 502 }));

    const result = await runOrderStatusSync();

    expect(result.updated).toBe(1);
    expect(result.eventsInserted).toBe(0);

    const [setArgs] = callsOf(calls, 'set').at(-1)!.args as [
      Record<string, unknown>,
    ];

    expect(setArgs.trackingNumber).toBe('CJP002');
  });
});
