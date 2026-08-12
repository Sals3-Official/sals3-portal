/**
 * Illustrative static data checked into this repository for interface
 * review only. No backend order system exists yet. Names, amounts, and
 * timestamps are examples, not real Sals3 orders.
 *
 * Amounts are stored as integer minor units and formatted at build time
 * against the active market, rather than being checked in as pre-formatted
 * strings. A hardcoded "₱1,284.00" would silently keep saying pesos on an AU
 * account, which is exactly the kind of quiet wrongness the market work in
 * `market-config.ts` exists to prevent.
 */

import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import {
  formatMarketMoney,
  formatSignedMarketMoney,
} from '@/lib/seller-center/money';
import type {
  AttentionReason,
  MoneyLine,
  OrderParcel,
  ParcelAction,
  ParcelDetail,
  ParcelLifecycleState,
  ParcelLine,
  ParcelRoute,
  ParcelStatus,
  ProcessStage,
  SettlementStatement,
  SupplierSpend,
  TrackingEvent,
  LifecycleEvent,
} from '@/modules/orders/contracts';

type ParcelFixture = {
  id: string;
  orderRef: string;
  parcelIndex: number;
  parcelCount: number;
  buyerLabel: string;
  buyerMessage: string | null;
  lines: ParcelLine[];
  buyerPaidMinor: number;
  commissionMinor: number | null;
  /**
   * This parcel's own allocated proceeds. On a split order it is a share of
   * the order payment, not the whole thing - summing the two parcels of
   * A-88217 must not double-count the buyer's ₱3,455.00.
   */
  proceedsMinor: number;
  supplierCostMinor: number | null;
  supplierCostNote: string | null;
  /** Set when the buyer payment covers the whole order, not just this parcel. */
  coversWholeOrder: boolean;
  status: ParcelStatus;
  state: ParcelLifecycleState;
  attentionReason: AttentionReason | null;
  stage: ProcessStage | null;
  route: ParcelRoute;
  actions: ParcelAction[];
  selectable: boolean;
};

const PARCEL_FIXTURES: ParcelFixture[] = [
  {
    id: 'A-88214-1',
    orderRef: 'A-88214',
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: 'R****o · Quezon City',
    buyerMessage: 'Please pack the thermal roll separately.',
    lines: [
      {
        id: 'A-88214-1-l1',
        title: 'Kraft mailer 32cm',
        variation: 'Brown · 50 pcs',
        quantity: 2,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 12 Aug 2026',
      },
      {
        id: 'A-88214-1-l2',
        title: 'Thermal roll 80mm',
        variation: null,
        quantity: 1,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 12 Aug 2026',
      },
    ],
    buyerPaidMinor: 128400,
    commissionMinor: -12840,
    proceedsMinor: 115560,
    supplierCostMinor: null,
    supplierCostNote: null,
    coversWholeOrder: false,
    status: {
      label: 'To process',
      detail:
        'To avoid a late shipment, arrange drop-off or pickup by 13 Aug 2026 (Thu).',
      tone: 'info',
    },
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
    actions: [
      {
        id: 'arrange',
        label: 'Arrange shipment',
        variant: 'primary',
        blockedReason: null,
      },
      {
        id: 'details',
        label: 'Check details',
        variant: 'secondary',
        blockedReason: null,
      },
    ],
    selectable: true,
  },
  {
    id: 'A-88218-1',
    orderRef: 'A-88218',
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: 'S********a · Iloilo',
    buyerMessage: null,
    lines: [
      {
        id: 'A-88218-1-l1',
        title: 'Poly mailer 25cm',
        variation: 'White · 100 pcs',
        quantity: 3,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 11 Aug 2026',
      },
    ],
    buyerPaidMinor: 89000,
    commissionMinor: -8900,
    proceedsMinor: 80100,
    supplierCostMinor: null,
    supplierCostNote: null,
    coversWholeOrder: false,
    status: {
      label: 'To process',
      detail:
        'Pickup is arranged for 13 Aug 2026 (Thu). Have the parcel packed and labelled before the courier arrives.',
      tone: 'info',
    },
    state: 'FULFILLMENT_QUEUED',
    attentionReason: null,
    stage: 'arranged',
    route: {
      kind: 'OWN_STOCK',
      serviceLevel: 'Standard delivery',
      carrier: 'Ninja Van',
      handover: 'PICK_UP',
      trackingNumber: 'NVPH0042188213',
    },
    actions: [
      {
        id: 'rearrange',
        label: 'Re-arrange pickup',
        variant: 'primary',
        blockedReason: null,
      },
      {
        id: 'waybill',
        label: 'Print waybill',
        variant: 'secondary',
        blockedReason: null,
      },
    ],
    selectable: true,
  },
  {
    id: 'A-88217-1',
    orderRef: 'A-88217',
    parcelIndex: 1,
    parcelCount: 2,
    buyerLabel: 'M****z · Makati',
    buyerMessage: null,
    lines: [
      {
        id: 'A-88217-1-l1',
        title: 'Kraft mailer 22cm',
        variation: 'Brown · 50 pcs',
        quantity: 2,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 12 Aug 2026',
      },
    ],
    buyerPaidMinor: 345500,
    commissionMinor: -34550,
    // Parcel 1 of 2 carries its own share of the order payment.
    proceedsMinor: 220950,
    supplierCostMinor: null,
    supplierCostNote: null,
    coversWholeOrder: true,
    status: {
      label: 'To process',
      detail:
        'Drop off by 13 Aug 2026 (Thu). This parcel ships separately from parcel 2.',
      tone: 'info',
    },
    state: 'PAID',
    attentionReason: null,
    stage: 'to-arrange',
    route: {
      kind: 'OWN_STOCK',
      serviceLevel: 'Standard delivery',
      carrier: 'Ninja Van',
      handover: 'DROP_OFF',
      trackingNumber: null,
    },
    actions: [
      {
        id: 'arrange',
        label: 'Arrange shipment',
        variant: 'primary',
        blockedReason: null,
      },
      {
        id: 'details',
        label: 'Check details',
        variant: 'secondary',
        blockedReason: null,
      },
    ],
    selectable: true,
  },
  {
    id: 'A-88217-2',
    orderRef: 'A-88217',
    parcelIndex: 2,
    parcelCount: 2,
    buyerLabel: 'M****z · Makati',
    buyerMessage: null,
    lines: [
      {
        id: 'A-88217-2-l1',
        title: 'Label printer ribbon',
        variation: '110mm × 74m',
        quantity: 1,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 12 Aug 2026',
      },
    ],
    buyerPaidMinor: 345500,
    commissionMinor: -34550,
    proceedsMinor: 90000,
    supplierCostMinor: 41200,
    supplierCostNote: 'paid from your CJ account',
    coversWholeOrder: true,
    status: {
      label: 'To process',
      detail:
        'Your supplier is preparing this parcel. Tracking appears once they hand it to the carrier.',
      tone: 'info',
    },
    state: 'FULFILLING',
    attentionReason: null,
    stage: 'supplier-preparing',
    route: {
      kind: 'SUPPLIER_DROPSHIP',
      serviceLevel: 'Standard delivery',
      carrier: null,
      supplierLabel: 'CJ',
      supplierOrderRef: 'CJ-77120934',
      trackingNumber: null,
    },
    // No waybill and no pickup: the seller never handles this parcel.
    actions: [
      {
        id: 'details',
        label: 'Check details',
        variant: 'secondary',
        blockedReason: null,
      },
    ],
    selectable: false,
  },
  {
    id: 'A-88219-1',
    orderRef: 'A-88219',
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: 'K****s · Pasig',
    buyerMessage: null,
    lines: [
      {
        id: 'A-88219-1-l1',
        title: 'Stretch film 500mm',
        variation: 'Clear',
        quantity: 1,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 12 Aug 2026',
      },
    ],
    buyerPaidMinor: 112000,
    commissionMinor: -11200,
    proceedsMinor: 100800,
    supplierCostMinor: 60400,
    supplierCostNote: 'due from your CJ account',
    coversWholeOrder: false,
    status: {
      label: 'Awaiting supplier funds',
      detail:
        'Your CJ wallet is ₱180.00 short of this supplier order. Top up to release it.',
      tone: 'danger',
    },
    state: 'AWAITING_SUPPLIER_FUNDS',
    attentionReason: 'funding',
    stage: null,
    route: {
      kind: 'SUPPLIER_DROPSHIP',
      serviceLevel: 'Standard delivery',
      carrier: null,
      supplierLabel: 'CJ',
      supplierOrderRef: null,
      trackingNumber: null,
    },
    actions: [
      {
        id: 'pay-supplier',
        label: 'Pay supplier order',
        variant: 'primary',
        blockedReason: 'Wallet balance too low to pay supplier',
      },
      {
        id: 'details',
        label: 'Check details',
        variant: 'secondary',
        blockedReason: null,
      },
    ],
    selectable: false,
  },
  {
    id: 'A-88216-1',
    orderRef: 'A-88216',
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: 'J****o · Davao',
    buyerMessage: null,
    lines: [
      {
        id: 'A-88216-1-l1',
        title: 'Bubble wrap 500mm',
        variation: '10m roll',
        quantity: 4,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 09 Aug 2026',
      },
    ],
    buyerPaidMinor: 218000,
    commissionMinor: -21800,
    proceedsMinor: 196200,
    supplierCostMinor: 104600,
    supplierCostNote: 'paid from your CJ account',
    coversWholeOrder: false,
    status: {
      label: 'Tracking conflict',
      detail:
        'The carrier reports this parcel delivered on 11 Aug 2026 while the supplier still reports it in transit. We are reconciling and will not change the delivered state until it resolves.',
      tone: 'warning',
    },
    state: 'TRACKING_CONFLICT',
    attentionReason: 'tracking-conflict',
    stage: null,
    route: {
      kind: 'SUPPLIER_DROPSHIP',
      serviceLevel: 'Standard delivery',
      carrier: 'J&T Express',
      supplierLabel: 'CJ',
      supplierOrderRef: null,
      trackingNumber: 'JT2260881144',
    },
    actions: [
      {
        id: 'details',
        label: 'Check details',
        variant: 'secondary',
        blockedReason: null,
      },
      {
        id: 'resolve',
        label: 'Resolve conflict',
        variant: 'primary',
        blockedReason: 'Locked while tracking is reconciled',
      },
    ],
    selectable: false,
  },
];

export function buildOrderParcels(market: SellerCenterMarket): OrderParcel[] {
  return PARCEL_FIXTURES.map((fixture) => ({
    id: fixture.id,
    orderRef: fixture.orderRef,
    parcelIndex: fixture.parcelIndex,
    parcelCount: fixture.parcelCount,
    buyerLabel: fixture.buyerLabel,
    buyerMessage: fixture.buyerMessage,
    lines: fixture.lines,
    money: {
      buyerPaidLabel: formatMarketMoney(fixture.buyerPaidMinor, market),
      commissionLabel:
        fixture.commissionMinor === null
          ? null
          : formatSignedMarketMoney(fixture.commissionMinor, market),
      supplierCostLabel:
        fixture.supplierCostMinor === null
          ? null
          : formatMarketMoney(fixture.supplierCostMinor, market),
      supplierCostNote: fixture.supplierCostNote,
      wholeOrderNote: fixture.coversWholeOrder ? '(whole order)' : null,
    },
    status: fixture.status,
    state: fixture.state,
    attentionReason: fixture.attentionReason,
    stage: fixture.stage,
    route: fixture.route,
    actions: fixture.actions,
    selectable: fixture.selectable,
    proceedsMinor: fixture.proceedsMinor,
  }));
}

/** Minor-unit totals for the one order the detail fixture covers. */
const DETAIL_SETTLEMENT = {
  merchandiseMinor: 345500,
  shippingPaidByBuyerMinor: 0,
  shippingChargedByProviderMinor: 0,
  commissionMinor: -34550,
  paymentFeeMinor: -3230,
  withholdingTaxMinor: -1382,
};

const DETAIL_SUPPLIER_SPEND = {
  productCostMinor: 35600,
  freightMinor: 5600,
};

function line(
  label: string,
  valueLabel: string,
  emphasis: MoneyLine['emphasis'],
  hint: string | null = null,
): MoneyLine {
  return { label, valueLabel, hint, emphasis };
}

function buildSettlement(market: SellerCenterMarket): SettlementStatement {
  const money = (minor: number) => formatMarketMoney(minor, market);
  const signed = (minor: number) => formatSignedMarketMoney(minor, market);
  const feesMinor =
    DETAIL_SETTLEMENT.commissionMinor +
    DETAIL_SETTLEMENT.paymentFeeMinor +
    DETAIL_SETTLEMENT.withholdingTaxMinor;
  const incomeMinor = DETAIL_SETTLEMENT.merchandiseMinor + feesMinor;

  return {
    groups: [
      {
        heading: 'Merchandise subtotal',
        lines: [
          line(
            'Merchandise subtotal',
            money(DETAIL_SETTLEMENT.merchandiseMinor),
            'total',
          ),
          line(
            'Product price',
            money(DETAIL_SETTLEMENT.merchandiseMinor),
            'sub',
          ),
        ],
      },
      {
        heading: 'Estimated shipping subtotal',
        lines: [
          line('Estimated shipping subtotal', money(0), 'total'),
          line(
            'Shipping fee paid by buyer',
            money(DETAIL_SETTLEMENT.shippingPaidByBuyerMinor),
            'sub',
          ),
          line(
            'Estimated shipping fee charged by logistics provider',
            money(DETAIL_SETTLEMENT.shippingChargedByProviderMinor),
            'sub',
          ),
        ],
      },
      {
        heading: 'Fees & charges',
        lines: [
          line('Fees & charges', signed(feesMinor), 'total'),
          line(
            'Sals3 commission',
            signed(DETAIL_SETTLEMENT.commissionMinor),
            'sub',
            'The marketplace commission Sals3 charges on a successful sale.',
          ),
          line(
            'Payment processing fee',
            signed(DETAIL_SETTLEMENT.paymentFeeMinor),
            'sub',
            'Charged by the payment provider that collected the buyer payment.',
          ),
          line(
            'Withholding tax',
            signed(DETAIL_SETTLEMENT.withholdingTaxMinor),
            'sub',
            'Withheld and remitted on your behalf where the market requires it.',
          ),
        ],
      },
    ],
    estimatedIncome: line(
      'Estimated seller income',
      money(incomeMinor),
      'accent',
      'An estimate until adjustments resolve. It becomes the final amount once they do.',
    ),
    finalAmount: line('Final amount', money(incomeMinor), 'accent'),
    buyerPayment: line(
      'Buyer payment',
      money(DETAIL_SETTLEMENT.merchandiseMinor),
      'total',
    ),
    buyerPaymentLines: [
      line(
        'Paid by card, 12 Aug 2026 01:43',
        money(DETAIL_SETTLEMENT.merchandiseMinor),
        'sub',
      ),
      line(
        'Shipping paid by buyer',
        money(DETAIL_SETTLEMENT.shippingPaidByBuyerMinor),
        'sub',
      ),
    ],
    adjustments: [],
  };
}

function buildSupplierSpend(market: SellerCenterMarket): SupplierSpend {
  const money = (minor: number) => formatMarketMoney(minor, market);
  const totalMinor =
    DETAIL_SUPPLIER_SPEND.productCostMinor + DETAIL_SUPPLIER_SPEND.freightMinor;

  return {
    lines: [
      line(
        'Supplier product cost',
        money(DETAIL_SUPPLIER_SPEND.productCostMinor),
        'sub',
      ),
      line(
        'Supplier freight',
        money(DETAIL_SUPPLIER_SPEND.freightMinor),
        'sub',
      ),
    ],
    totalLabel: money(totalMinor),
    accountLabel: 'Paid from your CJ account',
    walletStateLabel: `Wallet state at time of payment: covered in full, ${money(188000)} remaining.`,
  };
}

const TRACKING_EVENTS: Record<string, TrackingEvent[]> = {
  'A-88217-1': [
    {
      id: 'te-1',
      label: 'Waiting for drop-off at the branch',
      occurredAtLabel: '12 Aug 2026 09:12',
      source: 'CARRIER',
      isException: false,
    },
  ],
  'A-88217-2': [
    {
      id: 'te-2',
      label: 'Supplier is preparing the parcel',
      occurredAtLabel: '12 Aug 2026 08:40',
      source: 'SUPPLIER',
      isException: false,
    },
    {
      id: 'te-3',
      label: 'Pickup attempt was unsuccessful — courier rescheduled',
      occurredAtLabel: '12 Aug 2026 07:46',
      source: 'CARRIER',
      isException: true,
    },
    {
      id: 'te-4',
      label: 'Supplier order paid',
      occurredAtLabel: '12 Aug 2026 02:05',
      source: 'SUPPLIER',
      isException: false,
    },
  ],
};

const LIFECYCLE_EVENTS: LifecycleEvent[] = [
  {
    id: 'le-1',
    label: 'Supplier order created',
    occurredAtLabel: '12 Aug 2026 02:01',
  },
  {
    id: 'le-2',
    label: 'Payment captured',
    occurredAtLabel: '12 Aug 2026 01:44',
  },
  { id: 'le-3', label: 'New order', occurredAtLabel: '12 Aug 2026 01:43' },
];

/**
 * Detail for one parcel. Returns `null` for an unknown id so the route can
 * render a real 404 rather than an empty page that looks like a loading state.
 */
export function buildParcelDetail(
  parcelId: string,
  market: SellerCenterMarket,
): ParcelDetail | null {
  const parcel = buildOrderParcels(market).find(
    (candidate) => candidate.id === parcelId,
  );

  if (parcel === undefined) return null;

  const isDropship = parcel.route.kind === 'SUPPLIER_DROPSHIP';

  return {
    parcel,
    actions: parcel.actions,
    // Own-stock only: Sals3 holds the carrier relationship directly, so it is
    // Sals3's own courier assignment to show. A dropship courier is the
    // supplier's third party, and ADR-004 §3 keeps that personal data out.
    courierContactLabel: isDropship ? null : 'A. Bautista · 0917 442 8810',
    trackingEvents: TRACKING_EVENTS[parcel.id] ?? [],
    lifecycleEvents: LIFECYCLE_EVENTS,
    settlement: buildSettlement(market),
    supplierSpend: isDropship ? buildSupplierSpend(market) : null,
  };
}

export type ReprintHistoryEntry = {
  id: string;
  orderId: string;
  text: string;
  meta: string;
  tone: 'warning' | 'success';
};

export const REPRINT_HISTORY: ReprintHistoryEntry[] = [
  {
    id: 'rh-1',
    orderId: 'A-88203',
    text: 'reprinted — printer jam',
    meta: 'M. Reyes · 13:41 · reprint 1 of 1 · same tracking number',
    tone: 'warning',
  },
  {
    id: 'rh-2',
    orderId: 'A-88198',
    text: 'printed',
    meta: 'M. Reyes · 12:07 · first print',
    tone: 'success',
  },
  {
    id: 'rh-3',
    orderId: 'A-88191',
    text: 'printed',
    meta: 'A. Santos (staff) · 11:22 · first print',
    tone: 'success',
  },
];
