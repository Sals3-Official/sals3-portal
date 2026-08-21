// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { dbState } = vi.hoisted(() => ({ dbState: { db: null as unknown } }));

vi.mock('@/lib/db/client', () => ({ default: () => dbState.db }));

vi.mock('@/modules/reviews/eligibility', () => ({
  listLineReviewStates: vi.fn(),
}));

/* eslint-disable import/first */
import { listLineReviewStates } from '@/modules/reviews/eligibility';
import { fakeDb } from '../../../test/fake-db';
import { listBuyerOrders } from './buyer-read';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '44444444-4444-4444-8444-444444444444';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const LINE_ID = '55555555-5555-4555-8555-555555555555';

const ORDER_ROW = {
  id: ORDER_ID,
  orderNumber: 'S3-20260812-9F3C1A7B2E',
  checkoutIntentId: INTENT_ID,
  stripeCheckoutSessionId: 'cs_live_abc',
  stripePaymentIntentId: null,
  paymentStatus: 'PAID',
  buyerEmail: 'Buyer@Example.com',
  amountMinor: BigInt(13780),
  currency: 'USD',
  createdAt: new Date('2026-08-12T14:08:00Z'),
  updatedAt: new Date('2026-08-12T14:08:00Z'),
};

const GROUP_ROW = {
  id: GROUP_ID,
  orderId: ORDER_ID,
  packageId: 'pkg_1',
  supplierConnectionId: '33333333-3333-4333-8333-333333333333',
  originCountry: 'CN',
  destinationCountry: 'PH',
  logisticName: 'CJPacket Ordinary',
  optionId: 'option-1',
  channelId: 'channel-1',
  shippingAmountMinor: BigInt(2284),
  currency: 'USD',
  status: 'CJ_PAID',
  cjOrderId: null,
  cjShipmentOrderId: null,
  cjPayId: null,
  lastErrorCode: null,
  parcelState: 'DELIVERED',
  trackingNumber: 'CJP7742119055',
  supplierStatusRaw: 'DELIVERED',
  carrierDeliveredAt: new Date('2026-08-17T00:00:00Z'),
  lastSyncedAt: new Date('2026-08-18T00:00:00Z'),
  createdAt: new Date('2026-08-12T14:09:00Z'),
  updatedAt: new Date('2026-08-18T00:00:00Z'),
};

const LINE_ROW = {
  id: LINE_ID,
  orderId: ORDER_ID,
  fulfillmentGroupId: GROUP_ID,
  storeLineItemId: 'li_1',
  productId: '66666666-6666-4666-8666-666666666666',
  variantId: '77777777-7777-4777-8777-777777777777',
  title: 'Desk lamp',
  quantity: 1,
  variantLabel: 'Warm white-EU',
  unitAmountMinor: BigInt(11496),
  imageUrl: null,
  listingSnapshot: null,
  createdAt: new Date('2026-08-12T14:08:00Z'),
};

const INTENT_ROW = {
  id: INTENT_ID,
  addressSnapshot: {
    fullName: 'Buyer One',
    addressLine1: '1 Test Street',
    city: 'Manila',
    region: 'NCR',
    postalCode: '1000',
    country: 'PH',
    email: 'buyer@example.com',
  },
  shippingSelectionSnapshot: {
    packages: [{ packageId: 'pkg_1', arrivalTime: '12-18' }],
  },
};

function arrange() {
  const { db } = fakeDb([
    [ORDER_ROW],
    [GROUP_ROW],
    [LINE_ROW],
    [INTENT_ROW],
    [],
  ]);

  dbState.db = db;
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(listLineReviewStates).mockResolvedValue([]);
});

/**
 * An order page is a receipt.
 *
 * `sals3_product_reviews` reaches a deployed database through a
 * `workflow_dispatch`, not through the deploy, so there is a real window in
 * which this table does not exist while the code that reads it does. Without a
 * catch at this one call site, `42P01` would take down order history for every
 * buyer who has ever paid — the exact shape of the PR #102 outage, moved onto
 * the money path.
 */
describe('buyer orders when review state cannot be read', () => {
  it.each([
    [
      'the table does not exist',
      Object.assign(
        new Error('relation "sals3_product_reviews" does not exist'),
        {
          code: '42P01',
        },
      ),
    ],
    ['the query times out', new Error('canceling statement due to timeout')],
    [
      'the column list has drifted',
      Object.assign(new Error('bad column'), { code: '42703' }),
    ],
  ])('still returns the order when %s', async (_label, failure) => {
    arrange();
    asMock(listLineReviewStates).mockRejectedValue(failure);

    const orders = await listBuyerOrders('buyer@example.com');

    expect(orders).toHaveLength(1);
    expect(orders[0]?.packages[0]?.lines[0]?.title).toBe('Desk lamp');
  });

  /** The control is hidden, never offered on a guess. */
  it('reports the line as not reviewable rather than guessing', async () => {
    arrange();
    asMock(listLineReviewStates).mockRejectedValue(new Error('nope'));

    const orders = await listBuyerOrders('buyer@example.com');
    const line = orders[0]?.packages[0]?.lines[0];

    expect(line?.reviewable).toBe(false);
    expect(line?.review).toBeUndefined();
  });

  /** Money and fulfilment facts are untouched by a review-side failure. */
  it('keeps the amounts, tracking and ship-to intact', async () => {
    arrange();
    asMock(listLineReviewStates).mockRejectedValue(new Error('nope'));

    const [order] = await listBuyerOrders('buyer@example.com');

    expect(order?.amountTotalMinor).toBe(13780);
    expect(order?.packages[0]?.trackingNumber).toBe('CJP7742119055');
    expect(order?.shipTo.name).toBe('Buyer One');
  });

  it('passes the reviewable flag through when the read succeeds', async () => {
    arrange();
    asMock(listLineReviewStates).mockResolvedValue([
      { orderLineId: LINE_ID, reviewable: true, review: null },
    ]);

    const orders = await listBuyerOrders('buyer@example.com');

    expect(orders[0]?.packages[0]?.lines[0]?.reviewable).toBe(true);
  });

  it('passes an existing review through when the read succeeds', async () => {
    arrange();
    asMock(listLineReviewStates).mockResolvedValue([
      {
        orderLineId: LINE_ID,
        reviewable: false,
        review: {
          id: 'review-1',
          rating: 5,
          createdAt: '2026-08-19T10:00:00.000Z',
        },
      },
    ]);

    const orders = await listBuyerOrders('buyer@example.com');

    expect(orders[0]?.packages[0]?.lines[0]?.review?.rating).toBe(5);
  });

  /** The address is authorisation, and it must reach the resolver lower-cased. */
  it('asks for review state with the normalised buyer address', async () => {
    arrange();

    await listBuyerOrders('Buyer@Example.com');

    expect(listLineReviewStates).toHaveBeenCalledWith(
      expect.objectContaining({ buyerEmail: 'buyer@example.com' }),
      expect.anything(),
    );
  });
});
