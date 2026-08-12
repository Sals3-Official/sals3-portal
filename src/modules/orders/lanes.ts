import {
  LANES,
  type LaneKey,
  type OrderParcel,
  type ParcelLifecycleState,
} from './contracts';

/**
 * Lane resolution and list filtering.
 *
 * Everything here is a pure function over already-shaped parcels. No date
 * arithmetic and no "is this overdue" logic lives in this module: urgency is
 * decided upstream where a trusted clock exists, not in a list filter that
 * would silently disagree with the server that rendered the status sentence.
 */

/** Built once. `laneOf` runs per parcel per render; a linear scan of `LANES` would not. */
const LANE_BY_STATE = new Map<ParcelLifecycleState, LaneKey>(
  LANES.filter((lane) => lane.key !== 'all').flatMap((lane) =>
    lane.states.map((state) => [state, lane.key] as const),
  ),
);

/**
 * The lane a state belongs to, excluding `all`.
 *
 * Returns `attention` for anything unrecognised. A state that has been added
 * to the machine but not yet to a lane is a defect, and surfacing it in the
 * queue a human already watches is safer than dropping it from every tab -
 * which is what returning `null` would do. `lanes.test.ts` makes the real fix
 * mandatory by failing on any unmapped state.
 */
export function laneOf(state: ParcelLifecycleState): LaneKey {
  return LANE_BY_STATE.get(state) ?? 'attention';
}

export function isInLane(parcel: OrderParcel, lane: LaneKey): boolean {
  return lane === 'all' || laneOf(parcel.state) === lane;
}

export type LaneCount = { key: LaneKey; count: number };

/**
 * Counts for every lane, in `LANES` order.
 *
 * `all` counts every parcel. Lanes whose definition sets `showsCount: false`
 * are still counted here - whether a count is *rendered* is the tab
 * component's decision, and computing it either way keeps this function's
 * result independent of presentation.
 */
export function countByLane(parcels: readonly OrderParcel[]): LaneCount[] {
  const counts = new Map<LaneKey, number>(LANES.map((lane) => [lane.key, 0]));

  parcels.forEach((parcel) => {
    const lane = laneOf(parcel.state);

    counts.set(lane, (counts.get(lane) ?? 0) + 1);
  });

  counts.set('all', parcels.length);

  return LANES.map((lane) => ({
    key: lane.key,
    count: counts.get(lane.key) ?? 0,
  }));
}

export type ParcelFilter = {
  lane: LaneKey;
  route: string;
  stage: string;
  reason: string;
  field: string;
  q: string;
};

function matchesRoute(parcel: OrderParcel, route: string): boolean {
  if (route === 'all') return true;
  if (route === 'own-stock') return parcel.route.kind === 'OWN_STOCK';

  return (
    parcel.route.kind === 'SUPPLIER_DROPSHIP' &&
    parcel.route.supplierLabel.toLowerCase() === route.toLowerCase()
  );
}

function searchableValue(parcel: OrderParcel, field: string): string {
  switch (field) {
    case 'tracking':
      return parcel.route.trackingNumber ?? '';
    case 'buyer':
      return parcel.buyerLabel;
    case 'product':
      return parcel.lines.map((line) => line.title).join(' ');
    case 'order':
    default:
      return parcel.orderRef;
  }
}

/**
 * Applies lane, then the lane-specific chips, then search.
 *
 * The chip filters are deliberately scoped: `stage` only narrows *To process*
 * and `reason` only narrows *Needs attention*, because those are the only
 * lanes that render those chips. Applying a stale `?stage=` from a URL against
 * some other lane would silently empty a list the seller can see has rows.
 */
export function filterParcels(
  parcels: readonly OrderParcel[],
  filter: ParcelFilter,
): OrderParcel[] {
  const needle = filter.q.trim().toLowerCase();

  return parcels.filter((parcel) => {
    if (!isInLane(parcel, filter.lane)) return false;
    if (!matchesRoute(parcel, filter.route)) return false;

    if (
      filter.lane === 'to-process' &&
      filter.stage !== 'all' &&
      parcel.stage !== filter.stage
    ) {
      return false;
    }

    if (
      filter.lane === 'attention' &&
      filter.reason !== 'all' &&
      parcel.attentionReason !== filter.reason
    ) {
      return false;
    }

    if (needle === '') return true;

    return searchableValue(parcel, filter.field).toLowerCase().includes(needle);
  });
}

/**
 * "6 parcels" / "under 5 order references".
 *
 * Shopee switches its own counted unit per lane - parcels once a shipment
 * exists, orders before that. Stating both removes the ambiguity instead of
 * picking one: the parcel count is what the rows show, the order-reference
 * count is what the seller's buyer would recognise.
 */
export function describeResultCount(parcels: readonly OrderParcel[]): {
  countLabel: string;
  orderRefLabel: string;
} {
  const orderRefs = new Set(parcels.map((parcel) => parcel.orderRef));

  return {
    countLabel: `${parcels.length} ${parcels.length === 1 ? 'parcel' : 'parcels'}`,
    orderRefLabel: `under ${orderRefs.size} order ${
      orderRefs.size === 1 ? 'reference' : 'references'
    }`,
  };
}
