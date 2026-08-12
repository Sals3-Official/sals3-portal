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
    ...overrides,
  };
}

const EMPTY_FILTER = {
  lane: 'all' as LaneKey,
  route: 'all',
  stage: 'all',
  reason: 'all',
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

  it('ignores a stale stage outside to-process rather than emptying the list', () => {
    // A seller switching lanes carries `?stage=` along in the URL. Honouring it
    // in a lane that renders no stage chips would blank a list with no visible
    // cause.
    expect(
      filterParcels(parcels, {
        ...EMPTY_FILTER,
        lane: 'attention',
        stage: 'supplier-preparing',
      }).map((parcel) => parcel.id),
    ).toEqual(['c', 'd']);
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
          supplierLabel: 'CJ',
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
    expect(
      filterParcels(mixed, { ...EMPTY_FILTER, route: 'cj' }).map(
        (parcel) => parcel.id,
      ),
    ).toEqual(['cj']);
  });

  it('searches the selected field only', () => {
    const searchable = [
      parcelWith({ id: 'a', orderRef: 'A-88214' }),
      parcelWith({
        id: 'b',
        orderRef: 'A-99001',
        buyerLabel: 'K****s · Pasig',
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
        field: 'buyer',
        q: 'pasig',
      }).map((parcel) => parcel.id),
    ).toEqual(['b']);
    expect(
      filterParcels(searchable, {
        ...EMPTY_FILTER,
        field: 'buyer',
        q: '88214',
      }),
    ).toEqual([]);
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
