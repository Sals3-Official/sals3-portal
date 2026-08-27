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
    [],
    [{ id: 'step-create' }],
    [],
    [],
  ]);

  dbState.db = db;
  return calls;
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
