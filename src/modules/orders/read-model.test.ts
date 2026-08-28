// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { sals3OrderLines } from '@/lib/db/schema';
import { callsOf, fakeDb } from '../../../test/fake-db';

vi.mock('server-only', () => ({}));

const { dbState } = vi.hoisted(() => ({ dbState: { db: null as unknown } }));

vi.mock('@/lib/db/client', () => ({
  default: () => dbState.db,
}));

const {
  findOrderParcelDetailForSeller,
  listOrderParcelsForSeller,
  revealParcelContactForSeller,
} = await import('./read-model');

const SELLER_ID = '99999999-9999-4999-8999-999999999999';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '44444444-4444-4444-8444-444444444444';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

const ORDER_ROW = {
  id: ORDER_ID,
  orderNumber: 'S3-20260828-9F3C1A7B2E',
  checkoutIntentId: INTENT_ID,
  paymentStatus: 'PAID' as const,
  amountMinor: BigInt(13780),
  currency: 'USD',
  createdAt: new Date('2026-08-28T14:08:00Z'),
};

const GROUP_ROW = {
  id: GROUP_ID,
  orderId: ORDER_ID,
  packageId: 'pkg_1',
  shippingTier: 'Standard',
  supplierConnectionId: CONNECTION_ID,
  destinationCountry: 'PH',
  logisticName: 'CJPacket Ordinary',
  shippingAmountMinor: BigInt(2284),
  currency: 'USD',
  status: 'CJ_PAID' as const,
  cjOrderId: 'CJ123',
  lastErrorCode: null,
  parcelState: 'SHIPPED',
  trackingNumber: 'CJP7742119055',
  lastSyncedAt: new Date('2026-08-28T15:00:00Z'),
  createdAt: new Date('2026-08-28T14:09:00Z'),
  updatedAt: new Date('2026-08-28T15:00:00Z'),
};

const LINE_ROW = {
  id: '55555555-5555-4555-8555-555555555555',
  orderId: ORDER_ID,
  fulfillmentGroupId: GROUP_ID,
  title: 'Knitted Tam Beanie',
  quantity: 2,
  unitAmountMinor: BigInt(5748),
  currency: 'USD',
  variantLabel: 'Navy / One size',
  imageUrl: 'https://example.test/beanie.jpg',
  sals3Sku: 'S3-BEANIE-NAVY',
  supplierConnectionId: CONNECTION_ID,
  createdAt: new Date('2026-08-28T14:08:00Z'),
};

const INTENT_ROW = {
  id: INTENT_ID,
  addressSnapshot: {
    email: 'buyer@example.test',
    fullName: 'Rodrigo Santos',
    phone: '+639171234567',
    addressLine1: '12 Mabini Street',
    city: 'Quezon City',
    region: 'Metro Manila',
    postalCode: '1100',
    country: 'PH',
  },
  shippingSelectionSnapshot: {
    packageSelections: [{ packageId: 'pkg_1', arrivalTime: '18-22 Aug 2026' }],
  },
};

const CONNECTION_ROW = {
  id: CONNECTION_ID,
  displayName: 'CJ · Main',
  providerCode: 'CJ_DROPSHIPPING',
};

/**
 * Statement order matters: the fake resolves one queued result per `await`, in
 * the order the code issues them. Listing them here is also a readable
 * description of what the read costs — six statements for a whole page,
 * regardless of how many parcels come back.
 */
function results(overrides: {
  groups?: unknown[];
  lines?: unknown[];
}): unknown[][] {
  return [
    [{ orderId: ORDER_ID, createdAt: ORDER_ROW.createdAt }],
    [ORDER_ROW],
    overrides.groups ?? [GROUP_ROW],
    overrides.lines ?? [LINE_ROW],
    [INTENT_ROW],
    [CONNECTION_ROW],
  ];
}

/**
 * Deep-searches a value for a string, tolerating cycles.
 *
 * Drizzle's `sql` chunks hold a reference back to their own table, so the
 * object graph is circular and `JSON.stringify` throws on it. The seen-set is
 * what makes the walk terminate; without it this is an infinite loop rather
 * than a failing assertion.
 */
function containsValue(value: unknown, needle: string): boolean {
  const seen = new Set<unknown>();

  const walk = (node: unknown): boolean => {
    if (node === needle) return true;
    if (node === null || typeof node !== 'object') return false;
    if (seen.has(node)) return false;

    seen.add(node);

    return Object.values(node as Record<string, unknown>).some(walk);
  };

  return walk(value);
}

describe('listOrderParcelsForSeller', () => {
  it('renders an accepted order as a real parcel', async () => {
    const { db } = fakeDb(results({}));
    dbState.db = db;

    const [parcel] = await listOrderParcelsForSeller(SELLER_ID);

    expect(parcel.orderRef).toBe('S3-20260828-9F3C1A7B2E');
    expect(parcel.state).toBe('SHIPPED');
    expect(parcel.route.trackingNumber).toBe('CJP7742119055');
    expect(parcel.lines[0].title).toBe('Knitted Tam Beanie');
    expect(parcel.lines[0].variation).toBe('Navy / One size');
    expect(parcel.channel).toBe('Sals3 PH');
  });

  it('masks the buyer so no address reaches the list payload', async () => {
    const { db } = fakeDb(results({}));
    dbState.db = db;

    const [parcel] = await listOrderParcelsForSeller(SELLER_ID);

    expect(parcel.buyerLabel).not.toContain('Rodrigo Santos');
    expect(parcel.buyerLabel).not.toContain('Mabini');
    expect(JSON.stringify(parcel)).not.toContain('+639171234567');
    expect(JSON.stringify(parcel)).not.toContain('12 Mabini Street');
  });

  /**
   * The rule this whole screen exists for. A paid order whose fulfilment group
   * has not been created yet — the window between the accept endpoint and the
   * worker — must still appear, or a seller's newest sale is the one thing
   * they cannot see.
   */
  it('shows a paid order whose fulfilment group does not exist yet', async () => {
    const { db } = fakeDb(
      results({
        groups: [],
        lines: [{ ...LINE_ROW, fulfillmentGroupId: null }],
      }),
    );
    dbState.db = db;

    const parcels = await listOrderParcelsForSeller(SELLER_ID);

    expect(parcels).toHaveLength(1);
    expect(parcels[0].orderRef).toBe('S3-20260828-9F3C1A7B2E');
    expect(parcels[0].state).toBe('FULFILLMENT_QUEUED');
    expect(parcels[0].lines[0].title).toBe('Knitted Tam Beanie');
  });

  it('falls back to the fulfilment status when the sync has never run', async () => {
    const { db } = fakeDb(
      results({
        groups: [
          {
            ...GROUP_ROW,
            parcelState: null,
            status: 'AWAITING_SUPPLIER_FUNDS',
          },
        ],
      }),
    );
    dbState.db = db;

    const [parcel] = await listOrderParcelsForSeller(SELLER_ID);

    expect(parcel.state).toBe('AWAITING_SUPPLIER_FUNDS');
    expect(parcel.attentionReason).toBe('funding');
  });

  it('lets a refund outrank whatever the parcel was doing', async () => {
    const { db } = fakeDb([
      [{ orderId: ORDER_ID, createdAt: ORDER_ROW.createdAt }],
      [{ ...ORDER_ROW, paymentStatus: 'REFUNDED' }],
      [GROUP_ROW],
      [LINE_ROW],
      [INTENT_ROW],
      [CONNECTION_ROW],
    ]);
    dbState.db = db;

    const [parcel] = await listOrderParcelsForSeller(SELLER_ID);

    expect(parcel.state).toBe('REFUNDED');
  });

  /**
   * The anti-fabrication assertion. No commission ledger exists, so there is
   * no honest number for these fields — and the failure mode to guard against
   * is a future edit quietly deriving one from the buyer payment.
   */
  it('never invents a commission or a supplier cost', async () => {
    const { db } = fakeDb(results({}));
    dbState.db = db;

    const [parcel] = await listOrderParcelsForSeller(SELLER_ID);

    expect(parcel.money.commissionLabel).toBeNull();
    expect(parcel.money.supplierCostLabel).toBeNull();
    expect(parcel.money.supplierCostNote).toContain('Not configured');
  });

  it('reports what the buyer actually paid, in the order currency', async () => {
    const { db } = fakeDb(results({}));
    dbState.db = db;

    const [parcel] = await listOrderParcelsForSeller(SELLER_ID);

    // 13780 minor units on the order row, not a figure derived from the lines.
    expect(parcel.money.buyerPaidLabel).toContain('137.80');
    expect(parcel.currency).toBe('USD');
    // 2 x 5748, this parcel's own share.
    expect(parcel.proceedsMinor).toBe(11496);
  });

  /**
   * The tenant boundary has to be a `WHERE` clause, not a pass over rows the
   * caller should never have received. Asserting the predicate reaches the
   * query is the only way to notice the day somebody "simplifies" it into a
   * `.filter()`.
   */
  it('applies the seller scope inside the SQL', async () => {
    const { db, calls } = fakeDb(results({}));
    dbState.db = db;

    await listOrderParcelsForSeller(SELLER_ID);

    const whereClauses = callsOf(calls, 'where');

    expect(whereClauses.length).toBeGreaterThanOrEqual(3);
    // The three entry queries — the seller's order ids, their groups, their
    // lines — must each carry the seller id as a bound parameter. The later
    // statements (intents, connections) are keyed by ids those three already
    // scoped, so demanding the predicate there would assert a redundancy
    // rather than the boundary.
    //
    // Checked by walking the SQL object rather than serialising it: Drizzle's
    // chunks reference their own table, so `JSON.stringify` throws on the
    // cycle.
    const scoped = whereClauses.filter((clause) =>
      containsValue(clause.args, SELLER_ID),
    );

    expect(scoped).toHaveLength(3);
    // The join onto the connection table is what carries that scope.
    expect(callsOf(calls, 'innerJoin').length).toBeGreaterThanOrEqual(3);
  });

  it('answers an empty list without querying further', async () => {
    const { db, calls } = fakeDb([[]]);
    dbState.db = db;

    await expect(listOrderParcelsForSeller(SELLER_ID)).resolves.toEqual([]);
    expect(callsOf(calls, 'from')).toHaveLength(1);
  });
});

describe('findOrderParcelDetailForSeller', () => {
  /**
   * The regression this exists for.
   *
   * The detail read used to re-query `sals3_order_lines` by `order_id` with no
   * seller predicate and narrow the result with a JavaScript `.filter()`. On a
   * split order where two sellers each held ungrouped lines, the `unassigned`
   * parcel counted the other seller's lines as its own.
   *
   * Counting the reads is what pins it. Asserting the rendered number would
   * not: a fake executor returns whatever it is handed, so a reintroduced
   * unscoped query could still produce the right count here and the wrong one
   * in production.
   *
   * Two is the invariant, and both belong to the seller-scoped list: the
   * distinct-order query that finds which orders this seller has a stake in,
   * and the query that loads their lines. Both join `supplier_connections` and
   * name `seller_account_id` in the `WHERE`. A third read is the defect,
   * whatever it happens to return.
   */
  it('reads the order-line table only through the seller-scoped list', async () => {
    const { db, calls } = fakeDb([
      [{ orderId: ORDER_ID }], // resolveOwnedOrderId
      [ORDER_ROW],
      [GROUP_ROW],
      [LINE_ROW],
      [INTENT_ROW],
      [CONNECTION_ROW],
      [GROUP_ROW], // the parcel's own group
      [ORDER_ROW],
      [INTENT_ROW],
      [], // tracking events
    ]);
    dbState.db = db;

    await findOrderParcelDetailForSeller(GROUP_ID, SELLER_ID, false);

    const lineReads = callsOf(calls, 'from').filter((call) =>
      call.args.some((arg) => arg === sals3OrderLines),
    );

    expect(lineReads).toHaveLength(1);
  });

  /**
   * The ceiling belongs to the list and nothing else.
   *
   * The detail read used to reach its parcel by scanning the seller's most
   * recent `MAX_ORDERS` orders and searching the result, so a parcel on the
   * 201st-most-recent order was not slow to open — it answered 404. A real
   * order, owned by the seller asking for it, reported as not existing.
   *
   * `selectDistinct` is the capped scan, and it must not appear here. Asserting
   * its absence pins the property directly; asserting a statement count would
   * pass again the moment someone re-added the scan alongside a cheaper query.
   */
  it('opens a parcel without the list ceiling', async () => {
    const { db, calls } = fakeDb([
      [{ orderId: ORDER_ID }],
      [ORDER_ROW],
      [GROUP_ROW],
      [LINE_ROW],
      [INTENT_ROW],
      [CONNECTION_ROW],
      [GROUP_ROW],
      [ORDER_ROW],
      [INTENT_ROW],
      [],
    ]);
    dbState.db = db;

    const detail = await findOrderParcelDetailForSeller(
      GROUP_ID,
      SELLER_ID,
      false,
    );

    expect(detail).not.toBeNull();
    expect(callsOf(calls, 'selectDistinct')).toHaveLength(0);
    expect(callsOf(calls, 'limit').length).toBeGreaterThan(0);
  });

  /**
   * The ownership check moved from "is it in the seller's list" to a single
   * scoped lookup, so it has to keep answering the same way for a parcel that
   * is not theirs: nothing, and nothing distinguishable from absent.
   */
  it('refuses a parcel whose owning query returns no row', async () => {
    const { db } = fakeDb([[]]);
    dbState.db = db;

    await expect(
      findOrderParcelDetailForSeller(GROUP_ID, SELLER_ID, false),
    ).resolves.toBeNull();
  });
  it('refuses a parcel belonging to another seller', async () => {
    const { db } = fakeDb([[]]);
    dbState.db = db;

    await expect(
      findOrderParcelDetailForSeller(GROUP_ID, SELLER_ID, false),
    ).resolves.toBeNull();
  });
});

/**
 * The tenant boundary, asserted at every door into this module.
 *
 * Three functions can return another seller's data if their scope is ever
 * loosened, and each reaches the database by a different route. Testing only
 * the list would leave the two that matter most for privacy uncovered — the
 * detail read, which already had a scope defect once, and the reveal, which
 * returns a real buyer's name, phone and street address.
 *
 * These become load-bearing the day a second seller account exists. There is
 * one today, so nothing here can be caught by looking at production.
 */
describe('tenant boundary', () => {
  const NOT_A_SELLER = 'system';

  it('answers nothing for an id that cannot be a seller account', async () => {
    const { db, calls } = fakeDb(results({}));
    dbState.db = db;

    await expect(listOrderParcelsForSeller(NOT_A_SELLER)).resolves.toEqual([]);

    // Fail-closed *before* the database, because `seller_account_id` is a uuid
    // column: sending 'system' raises 22P02 and 500s the page rather than
    // returning no rows. `admin` holds order:read and may have no seller
    // account, so this is reachable.
    expect(calls).toHaveLength(0);
  });

  it('refuses a detail read for an unrecognisable seller', async () => {
    const { db, calls } = fakeDb(results({}));
    dbState.db = db;

    await expect(
      findOrderParcelDetailForSeller(GROUP_ID, NOT_A_SELLER, true),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('refuses to reveal buyer contact for an unrecognisable seller', async () => {
    const { db, calls } = fakeDb(results({}));
    dbState.db = db;

    await expect(
      revealParcelContactForSeller(GROUP_ID, NOT_A_SELLER),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  /**
   * The reveal is the highest-consequence read in this module: it returns a
   * real buyer's name, phone number and street address in plaintext. It had no
   * test at all until now.
   */
  it('reveals buyer contact only for a parcel the seller owns', async () => {
    const { db } = fakeDb(results({}));
    dbState.db = db;

    // A parcel id this seller's list does not contain is indistinguishable
    // from one that does not exist. Holding an id is not authorisation.
    await expect(
      revealParcelContactForSeller('not-this-sellers-parcel', SELLER_ID),
    ).resolves.toBeNull();
  });

  it('returns the plaintext contact for a parcel the seller does own', async () => {
    const { db } = fakeDb([
      ...results({}),
      [{ checkoutIntentId: INTENT_ID }],
      [INTENT_ROW],
    ]);
    dbState.db = db;

    const contact = await revealParcelContactForSeller(GROUP_ID, SELLER_ID);

    expect(contact).not.toBeNull();
    expect(contact!.name).toBe('Rodrigo Santos');
    expect(contact!.phone).toBe('+639171234567');
    expect(contact!.address).toContain('12 Mabini Street');
    expect(contact!.address).toContain('Quezon City');
  });

  it('carries the seller predicate into every entry query', async () => {
    const { db, calls } = fakeDb(results({}));
    dbState.db = db;

    await listOrderParcelsForSeller(SELLER_ID);

    const scoped = callsOf(calls, 'where').filter((clause) =>
      containsValue(clause.args, SELLER_ID),
    );

    expect(scoped).toHaveLength(3);
  });
});
