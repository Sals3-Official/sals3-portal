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

/**
 * A fixture line may omit the fields the builder can derive, so adding a
 * required field to `ParcelLine` does not mean editing every literal below.
 */
type FixtureLine = Omit<ParcelLine, 'sku' | 'deliveryRangeLabel'> & {
  sku?: string;
  deliveryRangeLabel?: string | null;
};

type ParcelFixture = {
  id: string;
  orderRef: string;
  parcelIndex: number;
  parcelCount: number;
  buyerLabel: string;
  buyerMessage: string | null;
  lines: FixtureLine[];
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
  channel: string;
  /** ISO dates so sorting needs no parsing and no timezone. */
  orderedAt: string;
  shipBy: string | null;
};

const PARCEL_FIXTURES: ParcelFixture[] = [
  {
    id: 'A-88214-1',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-12',
    shipBy: '2026-08-13',
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
    channel: 'Sals3 PH',
    orderedAt: '2026-08-11',
    shipBy: '2026-08-13',
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
    channel: 'Sals3 AU',
    orderedAt: '2026-08-12',
    shipBy: '2026-08-13',
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
    channel: 'Sals3 AU',
    orderedAt: '2026-08-12',
    shipBy: null,
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
    channel: 'Sals3 PH',
    orderedAt: '2026-08-12',
    shipBy: null,
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
    channel: 'Sals3 PH',
    orderedAt: '2026-08-09',
    shipBy: null,
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
  // The three below exist so every lane has something in it. A tab reading
  // zero forever is indistinguishable from a tab that is broken.
  {
    id: 'A-88211-1',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-10',
    shipBy: null,
    orderRef: 'A-88211',
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: 'A****z · Cebu',
    buyerMessage: null,
    lines: [
      {
        id: 'A-88211-1-l1',
        title: 'Packing tape 48mm',
        variation: 'Clear · 6 rolls',
        quantity: 1,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 10 Aug 2026',
      },
    ],
    buyerPaidMinor: 64200,
    commissionMinor: -6420,
    proceedsMinor: 57780,
    supplierCostMinor: null,
    supplierCostNote: null,
    coversWholeOrder: false,
    status: {
      label: 'Shipping',
      detail:
        'In transit with Ninja Van. Last scan 11 Aug 2026 at the Cebu sorting hub.',
      tone: 'neutral',
    },
    state: 'SHIPPED',
    attentionReason: null,
    stage: null,
    route: {
      kind: 'OWN_STOCK',
      serviceLevel: 'Standard delivery',
      carrier: 'Ninja Van',
      handover: 'PICK_UP',
      trackingNumber: 'NVPH0042177018',
    },
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
    id: 'A-88204-1',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-06',
    shipBy: null,
    orderRef: 'A-88204',
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: 'D****a · Bacolod',
    buyerMessage: null,
    lines: [
      {
        id: 'A-88204-1-l1',
        title: 'Fragile stickers 50mm',
        variation: 'Red · 200 pcs',
        quantity: 1,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 06 Aug 2026',
      },
    ],
    buyerPaidMinor: 38000,
    commissionMinor: -3800,
    proceedsMinor: 34200,
    supplierCostMinor: 19400,
    supplierCostNote: 'paid from your CJ account',
    coversWholeOrder: false,
    status: {
      label: 'Completed',
      detail:
        'Delivered on 09 Aug 2026. Both the carrier and your supplier report the same outcome.',
      tone: 'success',
    },
    state: 'DELIVERED',
    attentionReason: null,
    stage: null,
    route: {
      kind: 'SUPPLIER_DROPSHIP',
      serviceLevel: 'Standard delivery',
      carrier: 'J&T Express',
      supplierLabel: 'CJ',
      supplierOrderRef: 'CJ-77098220',
      trackingNumber: 'JT2260774091',
    },
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
    id: 'A-88196-1',
    channel: 'Sals3 AU',
    orderedAt: '2026-08-04',
    shipBy: null,
    orderRef: 'A-88196',
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: 'L****n · Davao',
    buyerMessage: null,
    lines: [
      {
        id: 'A-88196-1-l1',
        title: 'Kraft mailer 22cm',
        variation: 'Brown · 50 pcs',
        quantity: 1,
        imageUrl: null,
        acceptedOnLabel: 'as ordered on 04 Aug 2026',
      },
    ],
    buyerPaidMinor: 91000,
    commissionMinor: -9100,
    proceedsMinor: 81900,
    supplierCostMinor: null,
    supplierCostNote: null,
    coversWholeOrder: false,
    status: {
      label: 'Return in progress',
      detail:
        'The buyer is returning this parcel. It reaches you by 16 Aug 2026 and the refund is held until it arrives.',
      tone: 'neutral',
    },
    state: 'RETURN_IN_PROGRESS',
    attentionReason: null,
    stage: null,
    route: {
      kind: 'OWN_STOCK',
      serviceLevel: 'Standard delivery',
      carrier: 'Ninja Van',
      handover: 'PICK_UP',
      trackingNumber: 'NVPH0042166204',
    },
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
];

/**
 * Bulk filler so every lane has enough rows to look like a real day's work in
 * a demo.
 *
 * Written as a compact table rather than twenty more full fixtures: the six
 * above carry the cases that matter - split order, blocked action, tracking
 * conflict, buyer message - and repeating all that structure just to reach a
 * row count would bury them. Commission is a flat 10% here, which is a
 * placeholder and not an approved rate; ADR-008 leaves the real basis pending.
 */
type FillerSpec = {
  ref: string;
  buyer: string;
  channel: string;
  orderedAt: string;
  state: ParcelLifecycleState;
  tone: ParcelStatus['tone'];
  label: string;
  detail: string;
  supplier: string | null;
  carrier: string | null;
  tracking: string | null;
  paidMinor: number;
  title: string;
  variation: string | null;
  quantity: number;
  /** Required for anything in the attention lane, so its chips can filter. */
  attentionReason?: AttentionReason;
};

const FILLERS: FillerSpec[] = [
  // Unpaid
  {
    ref: 'A-88231',
    buyer: 'C****z · Taguig',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-12',
    state: 'PAYMENT_PENDING',
    tone: 'neutral',
    label: 'Unpaid',
    detail:
      'Waiting for the buyer to complete payment. It expires 14 Aug 2026.',
    supplier: null,
    carrier: null,
    tracking: null,
    paidMinor: 47500,
    title: 'Courier pouch A4',
    variation: 'White · 100 pcs',
    quantity: 1,
  },
  {
    ref: 'A-88230',
    buyer: 'V****a · Antipolo',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-12',
    state: 'CHECKOUT_PENDING',
    tone: 'neutral',
    label: 'Unpaid',
    detail: 'The buyer is still at checkout. Nothing is reserved yet.',
    supplier: null,
    carrier: null,
    tracking: null,
    paidMinor: 129000,
    title: 'Kraft mailer 32cm',
    variation: 'Brown · 50 pcs',
    quantity: 2,
  },
  {
    ref: 'A-88229',
    buyer: 'B****o · Cavite',
    channel: 'Sals3 AU',
    orderedAt: '2026-08-11',
    state: 'PAYMENT_FAILED',
    tone: 'neutral',
    label: 'Unpaid',
    detail:
      'The card was declined. The buyer has been asked to try another method.',
    supplier: null,
    carrier: null,
    tracking: null,
    paidMinor: 68000,
    title: 'Fragile stickers 50mm',
    variation: 'Red · 200 pcs',
    quantity: 1,
  },
  // To process
  {
    ref: 'A-88228',
    buyer: 'E****n · Laguna',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-12',
    state: 'CJ_ORDER_CREATED',
    tone: 'info',
    label: 'To process',
    detail: 'Supplier order created. Pay it to release the parcel for packing.',
    supplier: 'CJ',
    carrier: null,
    tracking: null,
    paidMinor: 84000,
    title: 'Bubble mailer 18cm',
    variation: 'Kraft · 100 pcs',
    quantity: 1,
  },
  {
    ref: 'A-88227',
    buyer: 'F****s · Pampanga',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-12',
    state: 'CJ_PAYMENT_PENDING',
    tone: 'info',
    label: 'To process',
    detail: 'Paying your CJ account now. This usually settles within the hour.',
    supplier: 'CJ',
    carrier: null,
    tracking: null,
    paidMinor: 156000,
    title: 'Packing tape 48mm',
    variation: 'Clear · 12 rolls',
    quantity: 2,
  },
  {
    ref: 'A-88226',
    buyer: 'G****l · Batangas',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-11',
    state: 'FULFILLMENT_QUEUED',
    tone: 'info',
    label: 'To process',
    detail:
      'Pickup is arranged for 13 Aug 2026 (Thu). Pack and label before the courier arrives.',
    supplier: null,
    carrier: 'Flash Express',
    tracking: 'FLPH0088231774',
    paidMinor: 72000,
    title: 'Poly mailer 25cm',
    variation: 'White · 100 pcs',
    quantity: 1,
  },
  // Shipping
  {
    ref: 'A-88224',
    buyer: 'H****t · Baguio',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-10',
    state: 'SHIPPED',
    tone: 'neutral',
    label: 'Shipping',
    detail:
      'In transit with Flash Express. Last scan 12 Aug 2026 at the Baguio hub.',
    supplier: null,
    carrier: 'Flash Express',
    tracking: 'FLPH0088219003',
    paidMinor: 51000,
    title: 'Thermal roll 80mm',
    variation: null,
    quantity: 3,
  },
  {
    ref: 'A-88223',
    buyer: 'I****d · Iloilo',
    channel: 'Sals3 AU',
    orderedAt: '2026-08-10',
    state: 'SHIPPED',
    tone: 'neutral',
    label: 'Shipping',
    detail: 'In transit with J&T Express. Out for delivery 13 Aug 2026.',
    supplier: 'CJ',
    carrier: 'J&T Express',
    tracking: 'JT2260812440',
    paidMinor: 143000,
    title: 'Label printer ribbon',
    variation: '110mm × 74m',
    quantity: 2,
  },
  {
    ref: 'A-88222',
    buyer: 'J****r · Cebu',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-09',
    state: 'SHIPPED',
    tone: 'neutral',
    label: 'Shipping',
    detail: 'In transit with Ninja Van. Handed over 11 Aug 2026.',
    supplier: null,
    carrier: 'Ninja Van',
    tracking: 'NVPH0042180991',
    paidMinor: 96000,
    title: 'Stretch film 500mm',
    variation: 'Clear',
    quantity: 4,
  },
  {
    ref: 'A-88221',
    buyer: 'K****y · Davao',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-09',
    state: 'SHIPPED',
    tone: 'neutral',
    label: 'Shipping',
    detail:
      'In transit with SPX Express. Last scan 12 Aug 2026 at the Davao hub.',
    supplier: 'CJ',
    carrier: 'SPX Express',
    tracking: 'PH265001229X',
    paidMinor: 61500,
    title: 'Kraft mailer 22cm',
    variation: 'Brown · 50 pcs',
    quantity: 1,
  },
  // Completed
  {
    ref: 'A-88208',
    buyer: 'M****l · Makati',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-05',
    state: 'DELIVERED',
    tone: 'success',
    label: 'Completed',
    detail: 'Delivered on 08 Aug 2026 and confirmed by the carrier.',
    supplier: null,
    carrier: 'Ninja Van',
    tracking: 'NVPH0042155018',
    paidMinor: 88000,
    title: 'Poly mailer 25cm',
    variation: 'White · 100 pcs',
    quantity: 2,
  },
  {
    ref: 'A-88207',
    buyer: 'N****e · Pasig',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-05',
    state: 'DELIVERED',
    tone: 'success',
    label: 'Completed',
    detail: 'Delivered on 07 Aug 2026. Both sources agree.',
    supplier: 'CJ',
    carrier: 'J&T Express',
    tracking: 'JT2260744120',
    paidMinor: 127000,
    title: 'Bubble wrap 500mm',
    variation: '10m roll',
    quantity: 3,
  },
  {
    ref: 'A-88206',
    buyer: 'O****a · Quezon City',
    channel: 'Sals3 AU',
    orderedAt: '2026-08-04',
    state: 'DELIVERED',
    tone: 'success',
    label: 'Completed',
    detail: 'Delivered on 07 Aug 2026 and signed for.',
    supplier: null,
    carrier: 'Flash Express',
    tracking: 'FLPH0088140221',
    paidMinor: 43000,
    title: 'Fragile stickers 50mm',
    variation: 'Red · 200 pcs',
    quantity: 1,
  },
  {
    ref: 'A-88203',
    buyer: 'P****o · Cebu',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-03',
    state: 'DELIVERED',
    tone: 'success',
    label: 'Completed',
    detail: 'Delivered on 06 Aug 2026.',
    supplier: 'CJ',
    carrier: 'SPX Express',
    tracking: 'PH264880012B',
    paidMinor: 210000,
    title: 'Courier pouch A4',
    variation: 'White · 100 pcs',
    quantity: 5,
  },
  {
    ref: 'A-88201',
    buyer: 'Q****n · Iloilo',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-02',
    state: 'DELIVERED',
    tone: 'success',
    label: 'Completed',
    detail: 'Delivered on 05 Aug 2026 and confirmed by the carrier.',
    supplier: null,
    carrier: 'Ninja Van',
    tracking: 'NVPH0042138877',
    paidMinor: 76500,
    title: 'Packing tape 48mm',
    variation: 'Clear · 6 rolls',
    quantity: 2,
  },
  // Returns and cancellations
  {
    ref: 'A-88198',
    buyer: 'R****y · Bacolod',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-02',
    state: 'REFUND_PENDING',
    tone: 'neutral',
    label: 'Refund pending',
    detail:
      'The returned parcel arrived. The refund releases once the item is inspected.',
    supplier: null,
    carrier: 'Ninja Van',
    tracking: 'NVPH0042131002',
    paidMinor: 59000,
    title: 'Thermal roll 80mm',
    variation: null,
    quantity: 2,
  },
  {
    ref: 'A-88195',
    buyer: 'S****g · Taguig',
    channel: 'Sals3 AU',
    orderedAt: '2026-08-01',
    state: 'CANCELLED',
    tone: 'neutral',
    label: 'Cancelled',
    detail:
      'Cancelled before the supplier order was paid. Nothing was charged to your CJ account.',
    supplier: 'CJ',
    carrier: null,
    tracking: null,
    paidMinor: 34000,
    title: 'Bubble mailer 18cm',
    variation: 'Kraft · 100 pcs',
    quantity: 1,
  },
  // Attention. Every reason chip needs at least one parcel behind it, or the
  // chip filters to an empty list and reads as broken.
  {
    ref: 'A-88225',
    buyer: 'U****k · Marikina',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-11',
    state: 'FULFILLMENT_FAILED',
    tone: 'danger',
    label: 'Supplier order failed',
    detail:
      'CJ rejected this supplier order: the variant is out of stock at the bound warehouse. Nothing was charged. Retry or cancel.',
    supplier: 'CJ',
    carrier: null,
    tracking: null,
    paidMinor: 79000,
    title: 'Bubble mailer 18cm',
    variation: 'Kraft · 100 pcs',
    quantity: 1,
    attentionReason: 'supplier-failure',
  },
  {
    ref: 'A-88220',
    buyer: 'W****f · Zamboanga',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-08',
    state: 'DELIVERY_EXCEPTION',
    tone: 'warning',
    label: 'Delivery exception',
    detail:
      'Two delivery attempts failed and the address could not be confirmed. The carrier holds it until 15 Aug 2026, then returns it.',
    supplier: null,
    carrier: 'Flash Express',
    tracking: 'FLPH0088177412',
    paidMinor: 118000,
    title: 'Kraft mailer 32cm',
    variation: 'Brown · 50 pcs',
    quantity: 2,
    attentionReason: 'delivery-exception',
  },
  // Unpaid, and one still a draft - the earliest state a parcel can be in.
  {
    ref: 'A-88233',
    buyer: 'X****m · Iligan',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-12',
    state: 'DRAFT',
    tone: 'neutral',
    label: 'Draft',
    detail: 'The buyer has not reached checkout. Nothing is reserved.',
    supplier: null,
    carrier: null,
    tracking: null,
    paidMinor: 25500,
    title: 'Fragile stickers 50mm',
    variation: 'Red · 200 pcs',
    quantity: 1,
  },
  {
    ref: 'A-88232',
    buyer: 'Y****p · Ormoc',
    channel: 'Sals3 AU',
    orderedAt: '2026-08-12',
    state: 'PAYMENT_PENDING',
    tone: 'neutral',
    label: 'Unpaid',
    detail:
      'The buyer chose bank transfer. We are waiting for the provider to confirm it.',
    supplier: null,
    carrier: null,
    tracking: null,
    paidMinor: 164000,
    title: 'Courier pouch A4',
    variation: 'White · 100 pcs',
    quantity: 3,
  },
  // Returns and cancellations, filling out the states the lane can hold.
  {
    ref: 'A-88194',
    buyer: 'Z****q · Naga',
    channel: 'Sals3 PH',
    orderedAt: '2026-08-01',
    state: 'CANCEL_REQUESTED',
    tone: 'neutral',
    label: 'Cancellation requested',
    detail:
      'The buyer asked to cancel. The supplier order is already paid, so this needs a decision before it ships.',
    supplier: 'CJ',
    carrier: null,
    tracking: null,
    paidMinor: 87000,
    title: 'Packing tape 48mm',
    variation: 'Clear · 12 rolls',
    quantity: 1,
  },
  {
    ref: 'A-88190',
    buyer: 'A****r · Dumaguete',
    channel: 'Sals3 PH',
    orderedAt: '2026-07-30',
    state: 'RETURNED',
    tone: 'neutral',
    label: 'Returned',
    detail:
      'Back in your stock on 03 Aug 2026 and inspected. The refund has settled.',
    supplier: null,
    carrier: 'Ninja Van',
    tracking: 'NVPH0042120884',
    paidMinor: 65000,
    title: 'Poly mailer 25cm',
    variation: 'White · 100 pcs',
    quantity: 1,
  },
  {
    ref: 'A-88192',
    buyer: 'T****h · Laguna',
    channel: 'Sals3 PH',
    orderedAt: '2026-07-31',
    state: 'REFUNDED',
    tone: 'neutral',
    label: 'Refunded',
    detail:
      'Refunded in full on 04 Aug 2026. The commission was reversed with it.',
    supplier: null,
    carrier: 'Flash Express',
    tracking: 'FLPH0088095517',
    paidMinor: 102000,
    title: 'Kraft mailer 32cm',
    variation: 'Brown · 50 pcs',
    quantity: 2,
  },
];

function fillerToFixture(spec: FillerSpec, index: number): ParcelFixture {
  const commissionMinor = -Math.round(spec.paidMinor * 0.1);
  const isDropship = spec.supplier !== null;

  return {
    id: `${spec.ref}-1`,
    channel: spec.channel,
    orderedAt: spec.orderedAt,
    shipBy: null,
    orderRef: spec.ref,
    parcelIndex: 1,
    parcelCount: 1,
    buyerLabel: spec.buyer,
    buyerMessage: null,
    lines: [
      {
        id: `${spec.ref}-1-l${index}`,
        title: spec.title,
        variation: spec.variation,
        quantity: spec.quantity,
        imageUrl: null,
        acceptedOnLabel: `as ordered on ${spec.orderedAt}`,
      },
    ],
    buyerPaidMinor: spec.paidMinor,
    commissionMinor,
    proceedsMinor: spec.paidMinor + commissionMinor,
    supplierCostMinor: isDropship ? Math.round(spec.paidMinor * 0.48) : null,
    supplierCostNote: isDropship ? 'paid from your CJ account' : null,
    coversWholeOrder: false,
    status: { label: spec.label, detail: spec.detail, tone: spec.tone },
    state: spec.state,
    attentionReason: spec.attentionReason ?? null,
    stage: null,
    route: isDropship
      ? {
          kind: 'SUPPLIER_DROPSHIP',
          serviceLevel: 'Standard delivery',
          carrier: spec.carrier,
          supplierLabel: spec.supplier ?? 'CJ',
          supplierOrderRef: null,
          trackingNumber: spec.tracking,
        }
      : {
          kind: 'OWN_STOCK',
          serviceLevel: 'Standard delivery',
          carrier: spec.carrier,
          handover: spec.carrier === null ? null : 'PICK_UP',
          trackingNumber: spec.tracking,
        },
    actions: [
      {
        id: 'details',
        label: 'Check details',
        variant: 'secondary',
        blockedReason: null,
      },
    ],
    selectable: false,
  };
}

const ALL_FIXTURES: ParcelFixture[] = [
  ...PARCEL_FIXTURES,
  ...FILLERS.map(fillerToFixture),
];

export function buildOrderParcels(market: SellerCenterMarket): OrderParcel[] {
  return ALL_FIXTURES.map((fixture) => ({
    id: fixture.id,
    orderRef: fixture.orderRef,
    parcelIndex: fixture.parcelIndex,
    parcelCount: fixture.parcelCount,
    buyerLabel: fixture.buyerLabel,
    buyerMessage: fixture.buyerMessage,
    lines: fixture.lines.map((fixtureLine) => ({
      ...fixtureLine,
      sku: fixtureLine.sku ?? `SKU-${fixtureLine.id.toUpperCase()}`,
      // Only a supplier gives us an estimate we can actually read, so an
      // own-stock parcel carries no window rather than an invented one.
      deliveryRangeLabel:
        fixtureLine.deliveryRangeLabel ??
        (fixture.route.kind === 'SUPPLIER_DROPSHIP' ? '18–22 Aug 2026' : null),
    })),
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
    channel: fixture.channel,
    orderedAt: fixture.orderedAt,
    shipBy: fixture.shipBy,
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
    buyer: {
      maskedName: parcel.buyerLabel,
      maskedPhone: 'Phone hidden',
      maskedAddress: '•••• Kalayaan Ave, Makati, 1209 Metro Manila',
      // Illustrative. A real implementation gates this on `order:fulfill`
      // and hands `null` to anyone who only holds `order:read`.
      revealed: {
        name: 'Maria Mendez',
        phone: '+63 917 220 4471',
        address: '4F Cituhall Bldg, 88 Kalayaan Ave, Makati, 1209 Metro Manila',
      },
      addressLabel: 'Work address',
    },
    riskFacts: [
      {
        id: 'ship-by',
        label: 'Ship-by deadline',
        value: isDropship
          ? 'Not set — the supplier ships'
          : '13 Aug 2026 (Thu)',
        tone: 'neutral',
      },
      {
        id: 'pickup-attempts',
        label: 'Pickup attempts',
        value: '1 failed, courier rescheduled',
        tone: 'warning',
      },
      {
        id: 'supplier-handover',
        label: 'Supplier handover',
        value: isDropship ? 'Not yet · CJ averages 1.2 days' : 'Not applicable',
        tone: 'neutral',
      },
      {
        id: 'late-shipments',
        label: 'Late shipments, last 30 days',
        value: '1 of 12 parcels',
        tone: 'neutral',
      },
    ],
    sellerNote: null,
    siblings: buildOrderParcels(market)
      .filter(
        (candidate) =>
          candidate.orderRef === parcel.orderRef && candidate.id !== parcel.id,
      )
      .map((candidate) => ({
        id: candidate.id,
        indexLabel: `Parcel ${candidate.parcelIndex} of ${candidate.parcelCount}`,
        routeLabel:
          candidate.route.kind === 'OWN_STOCK'
            ? 'In-House'
            : candidate.route.supplierLabel,
      })),
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
