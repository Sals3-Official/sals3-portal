/**
 * Order workspace domain contracts.
 *
 * ## The row is a parcel, not an order
 *
 * ADR-008 splits one customer checkout into per-provider fulfillment groups,
 * and CJ has no partial-shipment status - a split surfaces as separate
 * packages. A row keyed on the customer order would therefore carry two
 * statuses, two routes, and two action sets at once. The parcel is the unit
 * that has exactly one of each, so it is the unit this workspace lists.
 *
 * ## Presentation types carry strings, not values
 *
 * Every money field below is a *formatted string*, produced upstream by
 * `formatMarketMoney`. The components never see minor units and never do
 * arithmetic. That is deliberate: ADR-008 keeps Sals3 settlement and the
 * seller's own supplier spend on two independent rails, and a component that
 * held both as numbers could trivially subtract one from the other. Handing
 * it strings removes the capability rather than relying on nobody using it.
 */

/**
 * The ADR-004 §2 state machine, plus `TRACKING_CONFLICT` from §5.
 *
 * These are Sals3 states. A supplier's own status is translated into one of
 * these by `./cj-status`, never rendered directly - ADR-004 §2 requires
 * internal state independent of CJ's, and §6 forbids raw supplier vocabulary
 * reaching a seller-facing surface.
 */
export const PARCEL_LIFECYCLE_STATES = [
  // Primary
  'DRAFT',
  'CHECKOUT_PENDING',
  'PAYMENT_PENDING',
  'PAID',
  'FULFILLMENT_QUEUED',
  'CJ_ORDER_CREATED',
  'CJ_PAYMENT_PENDING',
  'FULFILLING',
  'SHIPPED',
  'DELIVERED',
  // Exception
  'PAYMENT_FAILED',
  'FULFILLMENT_FAILED',
  'AWAITING_SUPPLIER_FUNDS',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'DELIVERY_EXCEPTION',
  'TRACKING_CONFLICT',
  'REFUND_PENDING',
  'REFUNDED',
  'RETURN_IN_PROGRESS',
  'RETURNED',
] as const;

export type ParcelLifecycleState = (typeof PARCEL_LIFECYCLE_STATES)[number];

/** Lane keys. `all` is a view over every lane, not a member of the partition. */
export const LANE_KEYS = [
  'all',
  'unpaid',
  'to-process',
  'shipping',
  'completed',
  'returns',
  'attention',
] as const;

export type LaneKey = (typeof LANE_KEYS)[number];

export type LaneDefinition = {
  key: LaneKey;
  label: string;
  /**
   * Shopee omits a count on lanes where it would be noise - `All` and
   * `Unpaid` carry none. Same rule here: a count earns its place when it
   * represents work, not when it just measures history.
   */
  showsCount: boolean;
  /** `attention` renders in a warning tone so it reads as a queue, not a tab. */
  accent: boolean;
  states: readonly ParcelLifecycleState[];
};

/**
 * Lane membership. Every state in `PARCEL_LIFECYCLE_STATES` appears in exactly
 * one lane below, and `lanes.test.ts` fails the build if that stops being true
 * - a state silently belonging to no lane would vanish from every tab at once.
 *
 * `FULFILLING` sits in *To process* rather than a lane of its own. Shopee keeps
 * "arranged, awaiting pickup" inside *To Ship* and distinguishes it with a
 * chip; supplier-preparing is the same shape of thing, so it gets the same
 * treatment.
 */
export const LANES: readonly LaneDefinition[] = [
  {
    key: 'all',
    label: 'All',
    showsCount: false,
    accent: false,
    states: PARCEL_LIFECYCLE_STATES,
  },
  {
    key: 'unpaid',
    label: 'Unpaid',
    showsCount: false,
    accent: false,
    states: ['DRAFT', 'CHECKOUT_PENDING', 'PAYMENT_PENDING', 'PAYMENT_FAILED'],
  },
  {
    key: 'to-process',
    label: 'To process',
    showsCount: true,
    accent: false,
    states: [
      'PAID',
      'FULFILLMENT_QUEUED',
      'CJ_ORDER_CREATED',
      'CJ_PAYMENT_PENDING',
      'FULFILLING',
    ],
  },
  {
    key: 'shipping',
    label: 'Shipping',
    showsCount: true,
    accent: false,
    states: ['SHIPPED'],
  },
  {
    key: 'completed',
    label: 'Completed',
    showsCount: true,
    accent: false,
    states: ['DELIVERED'],
  },
  {
    key: 'returns',
    label: 'Returns & cancellations',
    showsCount: true,
    accent: false,
    states: [
      'CANCEL_REQUESTED',
      'CANCELLED',
      'REFUND_PENDING',
      'REFUNDED',
      'RETURN_IN_PROGRESS',
      'RETURNED',
    ],
  },
  {
    key: 'attention',
    label: 'Needs attention',
    showsCount: true,
    accent: true,
    states: [
      'FULFILLMENT_FAILED',
      'AWAITING_SUPPLIER_FUNDS',
      'DELIVERY_EXCEPTION',
      'TRACKING_CONFLICT',
    ],
  },
];

/** Why a parcel is in the attention lane. Drives that lane's chip row. */
export const ATTENTION_REASONS = [
  'funding',
  'supplier-failure',
  'tracking-conflict',
  'delivery-exception',
] as const;

export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/**
 * Sub-stage within *To process*. The two sets are disjoint because the work is
 * disjoint: a retailer is packing a box, a dropshipper is paying a supplier.
 * `OrdersChipRow` is handed whichever set applies and never chooses between
 * them itself.
 */
export const RETAILER_STAGES = ['all', 'to-arrange', 'arranged'] as const;
export const DROPSHIPPER_STAGES = [
  'all',
  'to-order',
  'to-pay',
  'supplier-preparing',
] as const;

export type ProcessStage =
  (typeof RETAILER_STAGES)[number] | (typeof DROPSHIPPER_STAGES)[number];

// --- Presentation contracts ---------------------------------------------

/**
 * One connected supplier account.
 *
 * Lives here rather than beside the adapter contract because `ParcelRoute`
 * needs it and the adapter needs `ParcelRoute`'s neighbours - defining it in
 * the adapter file would make the two modules import each other.
 */
export type SupplierConnectionRef = {
  connectionId: string;
  providerCode: string;
  /** Seller-facing, e.g. `CJ · Main`. Never used for routing decisions. */
  label: string;
};

export type ParcelRoute =
  | {
      kind: 'OWN_STOCK';
      serviceLevel: string;
      carrier: string | null;
      handover: 'DROP_OFF' | 'PICK_UP' | 'DROP_OFF_OR_PICK_UP' | null;
      trackingNumber: string | null;
    }
  | {
      kind: 'SUPPLIER_DROPSHIP';
      serviceLevel: string;
      carrier: string | null;
      /**
       * The exact connection fulfilling this parcel, not a display name.
       *
       * ADR-006 makes the connection the fulfillment authority, and one seller
       * can hold two accounts with the same provider. A bare "CJ" on a card
       * cannot say which wallet is short of funds or which account to top up,
       * and a route filter keyed on the label would merge them into one chip.
       */
      connection: SupplierConnectionRef;
      supplierOrderRef: string | null;
      trackingNumber: string | null;
    };

/**
 * One accepted line, as accepted.
 *
 * ADR-004 §7 and ADR-007 freeze the ordered item at acceptance: a later
 * supplier rename, media swap, or price edit changes future sales only. These
 * fields therefore come from the immutable `OrderLineSnapshot`, never from the
 * live listing, and `acceptedOnLabel` states that on the card so a seller
 * reading an old order knows what they are looking at.
 */
export type ParcelLine = {
  id: string;
  title: string;
  variation: string | null;
  quantity: number;
  imageUrl: string | null;
  acceptedOnLabel: string;
  sku: string;
  /**
   * The public product page for this item, or `null`.
   *
   * `null` whenever the link would not work: the product is not live, or this
   * deployment has no `SALS3_STOREFRONT_BASE_URL`. Offering a link that 404s
   * is the failure this screen has already removed twice.
   *
   * It resolves the product's *current* slug rather than the one frozen on the
   * order (ADR-007). That is not a contradiction: the frozen snapshot is the
   * record of what the buyer bought, and this is a way to go and look at the
   * listing as it stands. A re-slugged product should still open.
   */
  storefrontUrl: string | null;
  /**
   * Pre-formatted delivery window, e.g. `18–22 Aug 2026`.
   *
   * `null` on own-stock parcels, and that is not an oversight. The only
   * delivery estimate Sals3 can actually read today is the supplier's, so a
   * range on a parcel we ship ourselves would be invented. The label names the
   * source for the same reason - a window with no attribution reads as a
   * promise Sals3 made.
   */
  deliveryRangeLabel: string | null;
};

export type ParcelMoney = {
  /** Rail A - what the buyer paid Sals3. */
  buyerPaidLabel: string;
  /** Rail A - Sals3's commission on that sale. */
  commissionLabel: string | null;
  /**
   * Rail B - what the seller owes or paid their own supplier. ADR-008 keeps
   * this off the settlement rail entirely; it renders below a divider and is
   * never subtracted from anything above it.
   */
  supplierCostLabel: string | null;
  supplierCostNote: string | null;
  /** Set when the buyer payment covers more parcels than this one. */
  wholeOrderNote: string | null;
};

export type ParcelStatusTone =
  'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * A status is a label *and* a sentence saying what happens next and by when.
 * The label alone tells a seller where the parcel is; only the detail tells
 * them whether they have to do something about it.
 */
export type ParcelStatus = {
  label: string;
  detail: string;
  tone: ParcelStatusTone;
};

/**
 * `blockedReason` non-null renders the control greyed and unclickable with the
 * reason as its text, rather than removing it. An action that disappears looks
 * like a missing feature; one that explains itself is an answer.
 */
export type ParcelAction = {
  id: string;
  label: string;
  variant: 'primary' | 'secondary';
  blockedReason: string | null;
};

export type OrderParcel = {
  id: string;
  orderRef: string;
  parcelIndex: number;
  parcelCount: number;
  /** Already masked upstream. No address or phone reaches the list view. */
  buyerLabel: string;
  buyerMessage: string | null;
  lines: ParcelLine[];
  money: ParcelMoney;
  status: ParcelStatus;
  state: ParcelLifecycleState;
  attentionReason: AttentionReason | null;
  stage: ProcessStage | null;
  route: ParcelRoute;
  actions: ParcelAction[];
  selectable: boolean;
  /** Sales channel this parcel came through, e.g. `Sals3 PH`. */
  channel: string;
  /** ISO date the order was accepted. Sorting key; never rendered directly. */
  orderedAt: string;
  /** ISO date the parcel must leave by, or `null` when nothing is promised. */
  shipBy: string | null;
  /**
   * This parcel's own allocated share of what the buyer paid, in minor units.
   *
   * The one number on this type, and it is Rail A only. Selecting parcels has
   * to produce a running total, which strings cannot do - but supplier spend
   * stays string-only, so no component can subtract one rail from the other
   * even by accident. A parcel of a split order carries its own share, never
   * the whole order's payment.
   *
   * **It is buyer payment, not seller proceeds, and the two are not the same
   * number.** ADR-008 wants commission recorded per line so that proceeds can
   * be allocated this way, and no commission ledger exists yet - so nothing
   * can compute what the seller actually earns. Deriving it from a percentage
   * nobody approved would put a fabricated figure on a money screen. Anything
   * rendering this value must therefore label it as the buyer's payment; the
   * name is kept only because it is the allocation slot ADR-008 describes.
   */
  proceedsMinor: number;
  /**
   * ISO currency of `proceedsMinor`, taken from the order row.
   *
   * On the type because a bare minor-unit integer cannot be rendered without
   * it, and a component that guessed would format a Fijian order as Australian
   * dollars. It also lets a running total refuse to add two currencies
   * together rather than producing a meaningless sum.
   */
  currency: string;
};

// --- Detail view ---------------------------------------------------------

/**
 * A carrier or supplier event. ADR-004 §5 requires every source event stored,
 * so an exception renders inline here rather than overwriting the parcel
 * status - the status says where the parcel is, the feed says what happened.
 */
export type TrackingEvent = {
  id: string;
  label: string;
  occurredAtLabel: string;
  source: 'CARRIER' | 'SUPPLIER' | 'OPERATIONS';
  isException: boolean;
};

/** Order lifecycle only. Deliberately a separate feed from `TrackingEvent`. */
export type LifecycleEvent = {
  id: string;
  label: string;
  occurredAtLabel: string;
};

export type MoneyLine = {
  label: string;
  valueLabel: string;
  /** Tooltip copy. `null` renders no glyph at all. */
  hint: string | null;
  emphasis: 'total' | 'sub' | 'accent';
};

export type AdjustmentRow = {
  id: string;
  dateLabel: string;
  reason: string;
  amountLabel: string;
};

/** Rail A. Rendered by `SettlementStatement`. */
export type SettlementStatement = {
  groups: { heading: string; lines: MoneyLine[] }[];
  /** The label must retain the word "Estimated" until adjustments resolve. */
  estimatedIncome: MoneyLine;
  finalAmount: MoneyLine;
  buyerPayment: MoneyLine;
  buyerPaymentLines: MoneyLine[];
  adjustments: AdjustmentRow[];
};

/** Rail B. Rendered by `SupplierSpendPanel`, only for dropship parcels. */
export type SupplierSpend = {
  lines: MoneyLine[];
  totalLabel: string;
  accountLabel: string;
  walletStateLabel: string | null;
};

/**
 * Buyer contact, masked by default.
 *
 * `revealed` is `null` when the viewer may not see the real values, and the
 * control is then absent rather than disabled - an inert button still tells
 * someone the data is there and that they are being refused. Nothing here is
 * persisted: the reveal resets on every load, because a screen that stays
 * unmasked is one shoulder away from leaking a customer's address.
 */
export type BuyerIdentity = {
  maskedName: string;
  maskedPhone: string;
  maskedAddress: string;
  /**
   * Whether this viewer may ask for the real values - not the values
   * themselves.
   *
   * Shipping the plaintext alongside the mask and hiding it in the client
   * makes the masking cosmetic: the name, phone and full address sit in the
   * page payload where view-source reads them without anyone clicking, and the
   * permission check becomes decoration. Measured on the rendered page, which
   * is how this was caught. The real values come from a server action instead,
   * so the gate is on the server where it means something.
   */
  canReveal: boolean;
  addressLabel: string | null;
};

/** Returned by the reveal action. Never part of the page payload. */
export type RevealedContact = {
  name: string;
  phone: string;
  address: string;
};

/**
 * Fulfilment risk, as counted facts.
 *
 * Deliberately not a score, a percentage or a dial. The reference this design
 * studied shows a buyer's delivery-success rate, which is a *payment* risk
 * signal for cash-on-delivery - meaningless here, where the money is captured
 * before the parcel exists. What a Sals3 seller needs is whether this parcel
 * can actually be fulfilled, and that is a handful of plain counts.
 */
export type FulfilmentRiskFact = {
  id: string;
  label: string;
  value: string;
  tone: 'neutral' | 'warning' | 'danger';
};

export type ParcelDetail = {
  parcel: OrderParcel;
  actions: ParcelAction[];
  buyer: BuyerIdentity;
  riskFacts: FulfilmentRiskFact[];
  /** Private to the seller. Read-only until a write path exists. */
  sellerNote: string | null;
  /** Other parcels under the same order reference. Empty unless split. */
  siblings: { id: string; indexLabel: string; routeLabel: string }[];
  /** Own-stock only: Sals3 holds the carrier relationship directly. */
  courierContactLabel: string | null;
  trackingEvents: TrackingEvent[];
  lifecycleEvents: LifecycleEvent[];
  settlement: SettlementStatement;
  supplierSpend: SupplierSpend | null;
};
