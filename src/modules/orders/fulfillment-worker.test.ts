// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, callsOf } from '../../../test/fake-db';

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

const { default: handleFulfillOrder } = await import('./fulfillment-worker');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

function arrangeDb(country = 'PH') {
  const { db, calls } = fakeDb([
    [
      {
        id: ORDER_ID,
        orderNumber: 'S3-20260818-TEST',
        addressSnapshot: {
          email: 'buyer@example.com',
          fullName: 'Buyer One',
          phone: '+639000000000',
          addressLine1: '123 Test Street',
          city: 'Manila',
          region: 'Metro Manila',
          postalCode: '1000',
          country,
        },
      },
    ],
    [
      {
        id: GROUP_ID,
        orderId: ORDER_ID,
        packageId: 'pkg_1',
        supplierConnectionId: CONNECTION_ID,
        originCountry: 'CN',
        destinationCountry: country,
        logisticName: 'CJPacket Eub',
        optionId: 'option-1',
        channelId: 'channel-1',
        shippingAmountMinor: BigInt(500),
        currency: 'USD',
        status: 'PENDING',
        cjOrderId: null,
        cjShipmentOrderId: null,
        cjPayId: null,
        lastErrorCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      {
        id: 'line-1',
        orderId: ORDER_ID,
        fulfillmentGroupId: GROUP_ID,
        storeLineItemId: 'product-1:variant-1',
        productId: '44444444-4444-4444-8444-444444444444',
        variantId: '55555555-5555-4555-8555-555555555555',
        title: 'Test product',
        quantity: 2,
        unitAmountMinor: BigInt(1200),
        currency: 'USD',
        supplierConnectionId: CONNECTION_ID,
        externalProductId: 'CJ-PID-1',
        externalVariantId: 'CJ-VID-1',
        externalSku: 'CJ-SKU-1',
        sals3Sku: 'SALS3-SKU-1',
        imageUrl: null,
        createdAt: new Date(),
      },
    ],
    // The reconciliation lookup asks for an existing CREATE_ORDER_V3 row
    // first. Empty means this group has never called CJ, so there is nothing
    // to adopt and no lookup is issued.
    [],
    [],
    [{ id: 'step-create' }],
    [],
    [],
  ]);

  dbState.db = db;
  return calls;
}

/**
 * A group whose `CREATE_ORDER_V3` already failed once — the state an orphaned
 * order is left in, and the only state the reconciliation lookup runs for.
 */
function arrangeDbWithFailedCreate() {
  const { db, calls } = fakeDb([
    [
      {
        id: ORDER_ID,
        orderNumber: 'S3-20260818-TEST',
        addressSnapshot: {
          email: 'buyer@example.com',
          fullName: 'Buyer One',
          phone: '+639000000000',
          addressLine1: '123 Test Street',
          city: 'Manila',
          region: 'Metro Manila',
          postalCode: '1000',
          country: 'PH',
        },
      },
    ],
    [
      {
        id: GROUP_ID,
        orderId: ORDER_ID,
        packageId: 'pkg_1',
        supplierConnectionId: CONNECTION_ID,
        originCountry: 'CN',
        destinationCountry: 'PH',
        logisticName: 'CJPacket Eub',
        optionId: 'option-1',
        channelId: 'channel-1',
        shippingAmountMinor: BigInt(500),
        currency: 'USD',
        status: 'FULFILLMENT_FAILED',
        cjOrderId: null,
        cjShipmentOrderId: null,
        cjPayId: null,
        lastErrorCode: 'upstream-unavailable',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    [
      {
        id: 'line-1',
        orderId: ORDER_ID,
        fulfillmentGroupId: GROUP_ID,
        storeLineItemId: 'product-1:variant-1',
        externalVariantId: 'CJ-VID-1',
        externalSku: 'CJ-SKU-1',
        quantity: 2,
        unitAmountMinor: BigInt(1200),
      },
    ],
    // 4 — the reconciliation lookup finds the failed create.
    [{ id: 'step-create', status: 'FAILED', attempts: 1 }],
    // 5 — adopting, this is the step update; creating, it is `runStep` finding
    // that same failed row and reusing it rather than inserting a second.
    [{ id: 'step-create', status: 'FAILED', attempts: 1 }],
    [],
    [],
    // 8 — the ADD_CART insert the adopting path reaches once the create is
    // skipped. Without a row here it would throw before calling CJ, and the
    // "no duplicate" assertion would pass without ever proving the point.
    [{ id: 'step-cart' }],
    [],
    [],
  ]);

  dbState.db = db;
  return calls;
}

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

async function runUntilCreateOrderFails() {
  await expect(
    handleFulfillOrder({
      v: 1,
      operation: 'FULFILL_ORDER',
      idempotencyKey: `fulfill-order:${ORDER_ID}`,
      orderId: ORDER_ID,
    }),
  ).rejects.toThrow('unexpected-response');
}

describe('handleFulfillOrder CJ sandbox flag', () => {
  beforeEach(() => {
    delete process.env.CJ_ORDER_SANDBOX;
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(
      Response.json({ code: 500, message: 'sandbox probe stops here' }),
    );
  });

  it('sends createOrderV3 as sandbox by default', async () => {
    const calls = arrangeDb();

    await runUntilCreateOrderFails();

    const request = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(request.isSandbox).toBe(1);
    expect(request.products).toEqual([
      expect.objectContaining({ vid: 'CJ-VID-1', quantity: 2 }),
    ]);

    const stepInsert = callsOf(calls, 'values').find((call) =>
      Boolean((call.args[0] as { requestSnapshot?: unknown }).requestSnapshot),
    );

    expect(
      (stepInsert!.args[0] as { requestSnapshot: { isSandbox: number } })
        .requestSnapshot.isSandbox,
    ).toBe(1);
  });

  it('sends createOrderV3 as non-sandbox only when explicitly disabled', async () => {
    process.env.CJ_ORDER_SANDBOX = '0';
    arrangeDb();

    await runUntilCreateOrderFails();

    const request = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(request.isSandbox).toBe(0);
  });
});

describe('handleFulfillOrder CJ destination country', () => {
  beforeEach(() => {
    delete process.env.CJ_ORDER_SANDBOX;
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(
      Response.json({ code: 500, message: 'country probe stops here' }),
    );
  });

  /**
   * CJ takes the destination twice and wants it in two different formats:
   * `shippingCountry` is the country, `shippingCountryCode` its two-letter
   * code. The worker used to send the alpha-2 code to both, so every order
   * reached CJ reading `shippingCountry: 'PH'`.
   */
  it.each([
    ['PH', 'Philippines'],
    ['AU', 'Australia'],
  ])(
    'sends %s as a country name and a country code, not the code twice',
    async (code, name) => {
      arrangeDb(code);

      await runUntilCreateOrderFails();

      const request = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));

      expect(request.shippingCountry).toBe(name);
      expect(request.shippingCountryCode).toBe(code);
    },
  );

  it('records the country name in the step snapshot it will retry from', async () => {
    // `supplier_order_steps.requestSnapshot` is what a resumed fulfilment
    // replays. A snapshot holding the old code would re-send the wrong field
    // on every retry even after this fix shipped.
    const calls = arrangeDb('AU');

    await runUntilCreateOrderFails();

    const stepInsert = callsOf(calls, 'values').find((call) =>
      Boolean((call.args[0] as { requestSnapshot?: unknown }).requestSnapshot),
    );

    expect(
      (stepInsert!.args[0] as { requestSnapshot: { shippingCountry: string } })
        .requestSnapshot.shippingCountry,
    ).toBe('Australia');
  });
});

/**
 * The 2026-08-28 failure: `createOrderV3` was abandoned at the client timeout,
 * CJ completed the write anyway, and the portal kept a group with a null
 * `cj_order_id`. Every replay then re-sent the same deterministic
 * `orderNumber`, which CJ refused as a duplicate, so the order could never
 * move — and `status-sync` skips groups with no `cj_order_id`, so nothing
 * else would ever notice it.
 */
describe('handleFulfillOrder orphaned-order reconciliation', () => {
  beforeEach(() => {
    delete process.env.CJ_ORDER_SANDBOX;
    vi.clearAllMocks();
  });

  it('adopts the order CJ already has instead of creating a second one', async () => {
    const calls = arrangeDbWithFailedCreate();

    fetchMock
      .mockResolvedValueOnce(
        Response.json({ code: 200, data: { orderId: 'CJ-ORDER-9' } }),
      )
      .mockResolvedValue(
        Response.json({ code: 500, message: 'add-cart probe stops here' }),
      );

    await expect(
      handleFulfillOrder({
        v: 1,
        operation: 'FULFILL_ORDER',
        idempotencyKey: `fulfill-order:${ORDER_ID}`,
        orderId: ORDER_ID,
      }),
    ).rejects.toThrow('unexpected-response');

    const urls = requestedUrls();

    expect(urls[0]).toContain('/shopping/order/getOrderDetail');
    // The whole point: the duplicate is never sent, and the chain carries on
    // from the adopted order rather than stopping at the create.
    expect(urls.some((url) => url.includes('createOrderV3'))).toBe(false);
    expect(urls[1]).toContain('/shopping/order/addCart');

    const adopted = callsOf(calls, 'set').find((call) =>
      Boolean((call.args[0] as { cjOrderId?: unknown }).cjOrderId),
    );

    expect((adopted!.args[0] as { cjOrderId: string }).cjOrderId).toBe(
      'CJ-ORDER-9',
    );
  });

  it('creates the order when CJ has no record of it', async () => {
    arrangeDbWithFailedCreate();

    fetchMock
      .mockResolvedValueOnce(
        Response.json({ code: 1600, message: 'order not found' }),
      )
      .mockResolvedValue(
        Response.json({ code: 500, message: 'create probe stops here' }),
      );

    await expect(
      handleFulfillOrder({
        v: 1,
        operation: 'FULFILL_ORDER',
        idempotencyKey: `fulfill-order:${ORDER_ID}`,
        orderId: ORDER_ID,
      }),
    ).rejects.toThrow('unexpected-response');

    expect(requestedUrls().some((url) => url.includes('createOrderV3'))).toBe(
      true,
    );
  });

  /**
   * A lookup that failed for any other reason must not be read as "no such
   * order". Doing so would create a second supplier order for a buyer who
   * ordered once — a stuck retry is recoverable, a duplicate order is money.
   */
  it('does not create a duplicate when the lookup itself fails', async () => {
    arrangeDbWithFailedCreate();

    fetchMock.mockResolvedValue(
      Response.json({ code: 500, message: 'CJ is having a moment' }),
    );

    await expect(
      handleFulfillOrder({
        v: 1,
        operation: 'FULFILL_ORDER',
        idempotencyKey: `fulfill-order:${ORDER_ID}`,
        orderId: ORDER_ID,
      }),
    ).rejects.toThrow('unexpected-response');

    expect(requestedUrls().some((url) => url.includes('createOrderV3'))).toBe(
      false,
    );
  });

  /** A group that has never called CJ has nothing to adopt; the lookup is skipped. */
  it('spends no CJ call reconciling a first attempt', async () => {
    arrangeDb();
    fetchMock.mockResolvedValue(
      Response.json({ code: 500, message: 'create probe stops here' }),
    );

    await runUntilCreateOrderFails();

    expect(requestedUrls().some((url) => url.includes('getOrderDetail'))).toBe(
      false,
    );
  });
});
