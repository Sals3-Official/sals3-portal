// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';

vi.mock('server-only', () => ({}));

const { dbState } = vi.hoisted(() => ({ dbState: { db: null as unknown } }));

vi.mock('@/lib/db/client', () => ({
  default: () => dbState.db,
}));

const { listBuyerOrders, readBuyerOrder } = await import('./buyer-read');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '44444444-4444-4444-8444-444444444444';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';

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
  cjOrderId: 'CJ123',
  cjShipmentOrderId: 'SHIP123',
  cjPayId: 'PAY123',
  lastErrorCode: null,
  parcelState: 'SHIPPED',
  trackingNumber: 'CJP7742119055',
  supplierStatusRaw: 'SHIPPED',
  carrierDeliveredAt: null,
  lastSyncedAt: new Date('2026-08-18T00:00:00Z'),
  createdAt: new Date('2026-08-12T14:09:00Z'),
  updatedAt: new Date('2026-08-18T00:00:00Z'),
};

const LINE_ROW = {
  id: 'line-1',
  orderId: ORDER_ID,
  fulfillmentGroupId: GROUP_ID,
  storeLineItemId: 'sli-1',
  productId: '55555555-5555-4555-8555-555555555555',
  variantId: '66666666-6666-4666-8666-666666666666',
  title: 'Solar wall lamp',
  quantity: 2,
  unitAmountMinor: BigInt(2299),
  currency: 'USD',
  supplierConnectionId: '33333333-3333-4333-8333-333333333333',
  externalProductId: 'ext-p',
  externalVariantId: 'ext-v',
  externalSku: 'SKU1',
  sals3Sku: 'S3SKU1',
  variantLabel: 'Warm white-EU',
  imageUrl: null,
  createdAt: new Date('2026-08-12T14:09:00Z'),
};

/**
 * A line whose listing snapshot was captured. The fake executor returns rows
 * verbatim, so this is the shape the real column holds.
 */
const SNAPSHOT = {
  version: 1,
  productSlug: 'solar-wall-lamp',
  title: 'Solar wall lamp',
  categoryPath: 'Hardware > Lighting',
  options: [
    { name: 'Colour temperature', value: 'Warm white' },
    { name: 'Plug', value: 'EU' },
  ],
  imageUrls: ['https://media.example-r2.dev/lamp.webp'],
  description: { blocks: [{ type: 'paragraph', text: 'A solar lamp.' }] },
  specification: [{ label: 'Material', value: 'Aluminium' }],
  specs: {
    weightGrams: 400,
    lengthMillimeters: null,
    widthMillimeters: null,
    heightMillimeters: null,
    gtins: null,
    mpn: null,
    brand: 'Generic',
    condition: 'NEW',
  },
};

const INTENT_ROW = {
  id: INTENT_ID,
  addressSnapshot: {
    email: 'buyer@example.com',
    fullName: 'Buyer One',
    phone: '0917 000 0000',
    addressLine1: '123 Street',
    city: 'San Fernando',
    region: 'Pampanga',
    postalCode: '2000',
    country: 'PH',
  },
  shippingSelectionSnapshot: {
    packageSelections: [{ packageId: 'pkg_1', arrivalTime: '12-18' }],
  },
};

const EVENT_ROW = {
  id: 'evt-1',
  fulfillmentGroupId: GROUP_ID,
  source: 'CARRIER',
  label: 'Departed sorting facility',
  occurredAt: new Date('2026-08-15T22:41:00Z'),
  isException: false,
  dedupeKey: 'k1',
  createdAt: new Date('2026-08-16T00:00:00Z'),
};

// Statements awaited in order: orders select, then Promise.all(groups, lines,
// intents) in declaration order, then events.
function arrange(orderRows: unknown[], lineRows: unknown[] = [LINE_ROW]) {
  const { db } = fakeDb([
    orderRows,
    [GROUP_ROW],
    lineRows,
    [INTENT_ROW],
    [EVENT_ROW],
  ]);
  dbState.db = db;
}

describe('listBuyerOrders', () => {
  it('assembles packages, lines, events and ship-to for the buyer', async () => {
    arrange([ORDER_ROW]);

    const orders = await listBuyerOrders('buyer@example.com');

    expect(orders).toHaveLength(1);

    const [order] = orders;

    expect(order!.orderNumber).toBe('S3-20260812-9F3C1A7B2E');
    expect(order!.amountTotalMinor).toBe(13780);
    expect(order!.packages).toHaveLength(1);

    const [pkg] = order!.packages;

    expect(pkg!.carrier).toBe('CJPacket Ordinary');
    expect(pkg!.parcelState).toBe('SHIPPED');
    expect(pkg!.trackingNumber).toBe('CJP7742119055');
    expect(pkg!.arrivalDays).toBe('12-18');
    expect(pkg!.lines[0]!.variantLabel).toBe('Warm white-EU');
    expect(pkg!.events[0]!.source).toBe('CARRIER');
    expect(order!.shipTo.name).toBe('Buyer One');
  });

  it('never exposes supplier identifiers in the payload', async () => {
    arrange([ORDER_ROW]);

    const orders = await listBuyerOrders('buyer@example.com');
    const text = JSON.stringify(orders);

    expect(text).not.toContain('supplierConnectionId');
    expect(text).not.toContain('cjOrderId');
    expect(text).not.toContain('CJ123');
    expect(text).not.toContain('SHIP123');
    expect(text).not.toContain('PAY123');
    expect(text).not.toContain('supplierStatusRaw');
    expect(text).not.toContain('S3SKU1');
  });

  it('returns nothing for an empty email without touching the database', async () => {
    dbState.db = null;

    await expect(listBuyerOrders('   ')).resolves.toEqual([]);
  });
});

describe('readBuyerOrder', () => {
  it('returns null when the order belongs to a different email', async () => {
    const { db } = fakeDb([[ORDER_ROW]]);
    dbState.db = db;

    await expect(
      readBuyerOrder('other@example.com', 'S3-20260812-9F3C1A7B2E'),
    ).resolves.toBeNull();
  });

  it('matches the owner case-insensitively', async () => {
    arrange([ORDER_ROW]);

    const order = await readBuyerOrder(
      'BUYER@EXAMPLE.COM',
      's3-20260812-9f3c1a7b2e',
    );

    expect(order?.orderNumber).toBe('S3-20260812-9F3C1A7B2E');
  });

  it('returns null for an unknown number', async () => {
    const { db } = fakeDb([[]]);
    dbState.db = db;

    await expect(
      readBuyerOrder('buyer@example.com', 'S3-19990101-0000000000'),
    ).resolves.toBeNull();
  });
});

/**
 * Owner decision 2026-08-21: an order shows the listing as it was bought, so a
 * seller who renames a product or replaces its photos afterwards changes nothing
 * a past buyer sees.
 */
describe('frozen listing snapshot', () => {
  it('returns the captured listing beside the frozen columns', async () => {
    arrange([ORDER_ROW], [{ ...LINE_ROW, listingSnapshot: SNAPSHOT }]);

    const orders = await listBuyerOrders('buyer@example.com');
    const line = orders[0]!.packages[0]!.lines[0]!;

    expect(line.listing?.options).toEqual([
      { name: 'Colour temperature', value: 'Warm white' },
      { name: 'Plug', value: 'EU' },
    ]);
    expect(line.listing?.description?.blocks).toHaveLength(1);
    expect(line.listing?.imageUrls).toEqual([
      'https://media.example-r2.dev/lamp.webp',
    ]);
    // The three columns that were always frozen are still there and unchanged.
    expect(line.title).toBe('Solar wall lamp');
    expect(line.variantLabel).toBe('Warm white-EU');
  });

  /** Orders accepted before the column existed. */
  it('omits the listing entirely when nothing was captured', async () => {
    arrange([ORDER_ROW], [{ ...LINE_ROW, listingSnapshot: null }]);

    const orders = await listBuyerOrders('buyer@example.com');

    expect(orders[0]!.packages[0]!.lines[0]!.listing).toBeUndefined();
  });

  /**
   * A snapshot this deployment cannot read must not fail the page of a buyer who
   * has already paid. It degrades to the frozen columns.
   */
  it('omits an unreadable snapshot rather than throwing', async () => {
    arrange(
      [ORDER_ROW],
      [{ ...LINE_ROW, listingSnapshot: { version: 1, nonsense: true } }],
    );

    const orders = await listBuyerOrders('buyer@example.com');
    const line = orders[0]!.packages[0]!.lines[0]!;

    expect(line.listing).toBeUndefined();
    expect(line.title).toBe('Solar wall lamp');
  });

  /** ADR-004 section 6 — the snapshot must not become a leak of supplier facts. */
  it('never exposes supplier identity through the snapshot', async () => {
    arrange([ORDER_ROW], [{ ...LINE_ROW, listingSnapshot: SNAPSHOT }]);

    const serialised = JSON.stringify(
      await listBuyerOrders('buyer@example.com'),
    );

    expect(serialised).not.toContain(LINE_ROW.supplierConnectionId);
    expect(serialised).not.toContain(LINE_ROW.externalProductId);
    expect(serialised).not.toContain(LINE_ROW.externalVariantId);
  });
});
