import { describe, expect, it } from 'vitest';
import {
  LANES,
  PARCEL_LIFECYCLE_STATES,
  type LaneKey,
  type OrderParcel,
  type ParcelLifecycleState,
} from './contracts';
import {
  countByLane,
  describeResultCount,
  filterParcels,
  laneOf,
  sortParcels,
} from './lanes';

/**
 * The lane table is the only thing standing between the ADR-004 state machine
 * and a parcel that renders in no tab at all. A state added to the machine but
 * forgotten here would not fail typecheck and would not throw at runtime - it
 * would simply be invisible to the seller who has to act on it. These tests
 * exist to make that failure loud at build time instead.
 */

function parcelWith(overrides: Partial<OrderParcel>): OrderParcel {
  return {
    id: 'p-1',
    orderRef: 'A-1',
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: 'R****o · Quezon City',
    buyerMessage: null,
    lines: [
      {
        id: 'l-1',
        title: 'Kraft mailer 32cm',
        variation: null,
        quantity: 1,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 12 Aug 2026',
        sku: 'SL3-KRA-32',
        storefrontUrl: null,
        deliveryRangeLabel: null,
      },
    ],
    money: {
      buyerPaidLabel: '₱1,284.00',
      commissionLabel: '−₱128.40',
      supplierCostLabel: null,
      supplierCostNote: null,
      wholeOrderNote: null,
    },
    status: { label: 'To process', detail: 'Arrange pickup.', tone: 'info' },
    state: 'PAID',
    attentionReason: null,
    stage: 'to-arrange',
    route: {
      kind: 'OWN_STOCK',
      serviceLevel: 'Standard delivery',
      carrier: null,
      handover: 'DROP_OFF_OR_PICK_UP',
      trackingNumber: null,
    },
    actions: [],
    selectable: true,
    proceedsMinor: 115560,
    currency: 'USD',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-12',
    shipBy: '2026-08-13',
    ...overrides,
  };
}

const EMPTY_FILTER = {
  lane: 'all' as LaneKey,
  route: 'all',
  stage: 'all',
  reason: 'all',
  channel: 'all',
  field: 'order',
  q: '',
};

describe('lane coverage', () => {
  it('assigns every lifecycle state to exactly one lane', () => {
    const nonAllLanes = LANES.filter((lane) => lane.key !== 'all');

    PARCEL_LIFECYCLE_STATES.forEach((state) => {
      const owning = nonAllLanes.filter((lane) => lane.states.includes(state));

      expect(
        owning.map((lane) => lane.key),
        `${state} should belong to exactly one lane`,
      ).toHaveLength(1);
    });
  });

  it('defines no lane state outside the machine', () => {
    const known = new Set<string>(PARCEL_LIFECYCLE_STATES);

    LANES.forEach((lane) => {
      lane.states.forEach((state) => {
        expect(known.has(state), `${state} is not a lifecycle state`).toBe(
          true,
        );
      });
    });
  });

  it('routes each state through laneOf to its declared lane', () => {
    LANES.filter((lane) => lane.key !== 'all').forEach((lane) => {
      lane.states.forEach((state) => {
        expect(laneOf(state)).toBe(lane.key);
      });
    });
  });

  it('keeps an unmapped state visible rather than dropping it', () => {
    // Casting is the point: this simulates a state added to the machine and
    // forgotten in the lane table. It must surface somewhere a human looks.
    expect(laneOf('NOT_A_REAL_STATE' as ParcelLifecycleState)).toBe(
      'attention',
    );
  });
});

describe('countByLane', () => {
  it('counts all parcels under all, and each state under its own lane', () => {
    const counts = countByLane([
      parcelWith({ id: 'a', state: 'PAID' }),
      parcelWith({ id: 'b', state: 'FULFILLING' }),
      parcelWith({ id: 'c', state: 'SHIPPED' }),
      parcelWith({ id: 'd', state: 'AWAITING_SUPPLIER_FUNDS' }),
    ]);
    const byKey = new Map(counts.map((entry) => [entry.key, entry.count]));

    expect(byKey.get('all')).toBe(4);
    expect(byKey.get('to-process')).toBe(2);
    expect(byKey.get('shipping')).toBe(1);
    expect(byKey.get('attention')).toBe(1);
    expect(byKey.get('completed')).toBe(0);
  });

  it('returns an entry for every lane, in LANES order', () => {
    const counts = countByLane([]);

    expect(counts.map((entry) => entry.key)).toEqual(LANES.map((l) => l.key));
  });
});

describe('filterParcels', () => {
  const parcels = [
    parcelWith({ id: 'a', state: 'PAID', stage: 'to-arrange' }),
    parcelWith({ id: 'b', state: 'FULFILLING', stage: 'supplier-preparing' }),
    parcelWith({
      id: 'c',
      state: 'AWAITING_SUPPLIER_FUNDS',
      attentionReason: 'funding',
    }),
    parcelWith({
      id: 'd',
      state: 'TRACKING_CONFLICT',
      attentionReason: 'tracking-conflict',
    }),
  ];

  it('narrows to a lane', () => {
    const result = filterParcels(parcels, {
      ...EMPTY_FILTER,
      lane: 'to-process',
    });

    expect(result.map((parcel) => parcel.id)).toEqual(['a', 'b']);
  });

  it('applies stage only inside to-process', () => {
    expect(
      filterParcels(parcels, {
        ...EMPTY_FILTER,
        lane: 'to-process',
        stage: 'supplier-preparing',
      }).map((parcel) => parcel.id),
    ).toEqual(['b']);
  });

  it('applies stage in every lane, since every lane offers the chip', () => {
    // Parcels outside To process carry no stage, so a stage filter empties
    // those lanes. That is the honest result of the chip the seller clicked,
    // not a bug - silently ignoring it would leave the chip looking active
    // while changing nothing.
    expect(
      filterParcels(parcels, {
        ...EMPTY_FILTER,
        lane: 'attention',
        stage: 'supplier-preparing',
      }),
    ).toEqual([]);
  });

  it('applies reason only inside attention', () => {
    expect(
      filterParcels(parcels, {
        ...EMPTY_FILTER,
        lane: 'attention',
        reason: 'funding',
      }).map((parcel) => parcel.id),
    ).toEqual(['c']);
  });

  it('filters by route kind', () => {
    const mixed = [
      parcelWith({ id: 'own' }),
      parcelWith({
        id: 'cj',
        route: {
          kind: 'SUPPLIER_DROPSHIP',
          serviceLevel: 'Standard delivery',
          carrier: null,
          connection: {
            connectionId: 'conn-cj-main',
            providerCode: 'CJ',
            label: 'CJ · Main',
          },
          supplierOrderRef: 'CJ-1',
          trackingNumber: null,
        },
      }),
    ];

    expect(
      filterParcels(mixed, { ...EMPTY_FILTER, route: 'own-stock' }).map(
        (parcel) => parcel.id,
      ),
    ).toEqual(['own']);
    // Keyed on the connection id, not the provider label: two accounts with
    // one provider must stay separable.
    expect(
      filterParcels(mixed, { ...EMPTY_FILTER, route: 'conn-cj-main' }).map(
        (parcel) => parcel.id,
      ),
    ).toEqual(['cj']);
    expect(
      filterParcels(mixed, { ...EMPTY_FILTER, route: 'CJ · Main' }),
    ).toEqual([]);
  });

  it('searches the selected field only', () => {
    const searchable = [
      parcelWith({ id: 'a', orderRef: 'A-88214' }),
      parcelWith({
        id: 'b',
        orderRef: 'A-99001',
        route: {
          kind: 'SUPPLIER_DROPSHIP',
          serviceLevel: 'Standard',
          carrier: 'CJPacket',
          connection: {
            connectionId: 'conn-1',
            providerCode: 'CJ_DROPSHIPPING',
            label: 'CJ · Main',
          },
          supplierOrderRef: null,
          trackingNumber: 'CJP7742119055',
        },
      }),
    ];

    expect(
      filterParcels(searchable, {
        ...EMPTY_FILTER,
        field: 'order',
        q: '88214',
      }).map((parcel) => parcel.id),
    ).toEqual(['a']);
    expect(
      filterParcels(searchable, {
        ...EMPTY_FILTER,
        field: 'tracking',
        q: '7742119',
      }).map((parcel) => parcel.id),
    ).toEqual(['b']);
    expect(
      filterParcels(searchable, {
        ...EMPTY_FILTER,
        field: 'tracking',
        q: '88214',
      }),
    ).toEqual([]);
  });

  /**
   * `buyer` was offered as a search field and could never match a name: the
   * list holds `M****a · Quezon City`. It is gone from `ORDER_SEARCH_FIELDS`,
   * but a bookmark can still carry `?field=buyer`, and that must not silently
   * search something else and present the result as a buyer match.
   *
   * It falls back to the order reference, which is what any unrecognised field
   * does. Asserted so the fallback is a decision rather than an accident.
   */
  it('treats a stale buyer field as an order-reference search', () => {
    const searchable = [
      parcelWith({ id: 'a', orderRef: 'A-88214' }),
      parcelWith({ id: 'b', orderRef: 'A-99001' }),
    ];

    expect(
      filterParcels(searchable, {
        ...EMPTY_FILTER,
        field: 'buyer',
        q: '88214',
      }).map((parcel) => parcel.id),
    ).toEqual(['a']);
  });
});

describe('channel filter', () => {
  it('narrows to one sales channel', () => {
    const mixed = [
      parcelWith({ id: 'ph', channel: 'Sals3 PH' }),
      parcelWith({ id: 'au', channel: 'Sals3 AU' }),
    ];

    expect(
      filterParcels(mixed, { ...EMPTY_FILTER, channel: 'Sals3 AU' }).map(
        (parcel) => parcel.id,
      ),
    ).toEqual(['au']);
    expect(filterParcels(mixed, EMPTY_FILTER)).toHaveLength(2);
  });
});

describe('sortParcels', () => {
  it('defaults to newest order date first', () => {
    const result = sortParcels(
      [
        parcelWith({ id: 'old', orderedAt: '2026-08-09' }),
        parcelWith({ id: 'new', orderedAt: '2026-08-12' }),
        parcelWith({ id: 'mid', orderedAt: '2026-08-11' }),
      ],
      'order-date-desc',
    );

    expect(result.map((parcel) => parcel.id)).toEqual(['new', 'mid', 'old']);
  });

  /**
   * `ship-by-asc` was an offered sort that reordered nothing: no dropship
   * parcel carries a despatch promise, so every `shipBy` was null and the
   * comparator returned 0 for every pair. The option is gone, but a bookmark
   * can still carry it, and the honest answer to such a link is the one real
   * order rather than an error or an unchanged-looking list.
   */
  it('answers a stale ship-by sort with newest order first', () => {
    const result = sortParcels(
      [
        parcelWith({ id: 'older', orderedAt: '2026-08-13' }),
        parcelWith({ id: 'newer', orderedAt: '2026-08-15' }),
      ],
      'ship-by-asc',
    );

    expect(result.map((parcel) => parcel.id)).toEqual(['newer', 'older']);
  });

  it('does not mutate the input', () => {
    const input = [
      parcelWith({ id: 'a', orderedAt: '2026-08-09' }),
      parcelWith({ id: 'b', orderedAt: '2026-08-12' }),
    ];

    sortParcels(input, 'order-date-desc');

    expect(input.map((parcel) => parcel.id)).toEqual(['a', 'b']);
  });
});

describe('describeResultCount', () => {
  it('counts parcels and distinct order references separately', () => {
    const split = [
      parcelWith({ id: 'a', orderRef: 'A-1', parcelIndex: 1, parcelCount: 2 }),
      parcelWith({ id: 'b', orderRef: 'A-1', parcelIndex: 2, parcelCount: 2 }),
      parcelWith({ id: 'c', orderRef: 'A-2' }),
    ];

    expect(describeResultCount(split)).toEqual({
      countLabel: '3 parcels',
      orderRefLabel: 'under 2 order references',
    });
  });

  it('singularises both counts', () => {
    expect(describeResultCount([parcelWith({})])).toEqual({
      countLabel: '1 parcel',
      orderRefLabel: 'under 1 order reference',
    });
  });
});
