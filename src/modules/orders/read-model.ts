import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import {
  checkoutIntents,
  fulfillmentGroups,
  parcelTrackingEvents,
  sals3OrderLines,
  sals3Orders,
  supplierConnections,
  supplierProviders,
} from '@/lib/db/schema';
import { isShippingTier } from '@/modules/checkout/shipping-tiers';
import { listPublishedSlugsForProducts } from '@/modules/catalog/storefront/read-model';
import storefrontOrigin from '@/lib/storefront/origin';
import formatParcelMoney from './money';
import {
  PARCEL_LIFECYCLE_STATES,
  type AttentionReason,
  type BuyerIdentity,
  type FulfilmentRiskFact,
  type LifecycleEvent,
  type MoneyLine,
  type OrderParcel,
  type ParcelAction,
  type ParcelDetail,
  type ParcelLifecycleState,
  type ParcelLine,
  type ParcelMoney,
  type ParcelRoute,
  type ParcelStatus,
  type ProcessStage,
  type RevealedContact,
  type SettlementStatement,
  type SupplierSpend,
  type TrackingEvent,
} from './contracts';
import { arrivalWindowsByPackage, readAddressSnapshot } from './snapshots';

/**
 * The seller's view of their own parcels, read from the database.
 *
 * The counterpart to `buyer-read.ts`: same tables, opposite audience. The
 * buyer reads the orders they paid for; a seller reads the parcels their own
 * supplier connection is fulfilling.
 *
 * ## The tenant filter is the supplier connection, and it lives in the `WHERE`
 *
 * No order table carries a `seller_account_id`. The link is
 * `fulfillment_groups.supplier_connection_id -> supplier_connections
 * .seller_account_id`, and ADR-006 makes that connection the fulfilment
 * authority, so it is the correct owner of a parcel rather than a convenient
 * proxy for one. It is applied as a join predicate, never as a post-fetch
 * `filter`: a tenant boundary that a call site can forget is not a boundary.
 *
 * ## What this module refuses to invent
 *
 * Sals3's commission, the settlement statement, and the seller's own supplier
 * spend are all Rail A/Rail B concepts from ADR-008, and **none of them has a
 * backing ledger today** — the vault records the commission ledger and payout
 * statements as still open. Every one of those fields therefore renders as an
 * explicit "not configured" line rather than a number.
 *
 * That is a deliberate choice over the two alternatives. Deriving a commission
 * from a percentage nobody has approved would put a fabricated figure on a
 * money screen, which the operating contract forbids outright; hiding the rows
 * would make a seller believe the question had been answered. A named gap is
 * the only honest third option.
 *
 * What *is* real and comes straight from the row: what the buyer paid, the
 * freight they were charged, the ordered lines frozen at acceptance, the
 * carrier and tracking number, the lifecycle state, and every tracking event.
 */

/**
 * Hard ceiling on **orders** read for one seller, matching `buyer-read.ts`'s
 * own `MAX_ORDERS`. An unbounded scan over a table that grows with every sale
 * is the kind of query that is fine for a year and then is not.
 *
 * Named for orders because that is what it limits: the predicate sits on the
 * distinct-order query, and a split order yields more than one parcel, so the
 * number of *parcels* returned can exceed this. It was called `MAX_PARCELS`,
 * which described a ceiling the code does not enforce.
 */
export const MAX_ORDERS = 200;

/** The tables this screen cannot render without. */
const REQUIRED_TABLES = [
  'checkout_intents',
  'sals3_orders',
  'sals3_order_lines',
  'fulfillment_groups',
] as const;

/**
 * Distinguishes "not migrated here" from "the database is down".
 *
 * The order tables reach a database through a `CRON_SECRET` break-glass run,
 * not through the deploy, so there is a real window where this screen exists
 * and its tables do not — and a developer's local database is in that window
 * indefinitely, because the standing rule is never to migrate it. Production
 * has them; a laptop does not.
 *
 * `readOrUnavailable` cannot answer this and should not: it treats only
 * connection-class errors as unavailable and rethrows `undefined_table`, which
 * is correct, because a portal-wide helper that swallowed `42P01` would hide
 * genuine schema drift everywhere. So the check is explicit and its copy names
 * the migration. The PR #102 lesson is that **a migration gap has to be
 * legible as a migration gap**, not dressed up as an outage — and certainly
 * not as an empty order book, which is the reading that would send someone
 * hunting for lost sales.
 *
 * Modelled on `readExistingReviewTables`, which solved the same problem for
 * `/reviews`.
 */
export async function orderTablesExist(
  options: { executor?: DbExecutor } = {},
): Promise<boolean> {
  const executor = options.executor ?? getDb();
  const names = REQUIRED_TABLES.map((name) => `'${name}'`).join(', ');

  const rows = (await executor.execute(
    sql.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN (${names})`,
    ),
  )) as unknown as { table_name?: unknown }[];

  const present = new Set(
    rows
      .map((row) => row.table_name)
      .filter((name) => typeof name === 'string'),
  );

  return REQUIRED_TABLES.every((name) => present.has(name));
}

/**
 * Named columns, never a bare `.select()`.
 *
 * Drizzle expands `.select()` to every column the *schema file* declares, so a
 * deployment whose schema is ahead of the database fails the whole query with
 * `column ... does not exist`. `order-line-columns.test.ts` pins this rule for
 * the writer; it applies just as hard to the reader.
 */
const SELLER_LINE_COLUMNS = {
  id: sals3OrderLines.id,
  orderId: sals3OrderLines.orderId,
  fulfillmentGroupId: sals3OrderLines.fulfillmentGroupId,
  productId: sals3OrderLines.productId,
  title: sals3OrderLines.title,
  quantity: sals3OrderLines.quantity,
  unitAmountMinor: sals3OrderLines.unitAmountMinor,
  currency: sals3OrderLines.currency,
  variantLabel: sals3OrderLines.variantLabel,
  imageUrl: sals3OrderLines.imageUrl,
  sals3Sku: sals3OrderLines.sals3Sku,
  supplierConnectionId: sals3OrderLines.supplierConnectionId,
  createdAt: sals3OrderLines.createdAt,
} as const;

type SellerLineRow = {
  id: string;
  orderId: string;
  fulfillmentGroupId: string | null;
  productId: string;
  title: string;
  quantity: number;
  unitAmountMinor: bigint;
  currency: string;
  variantLabel: string | null;
  imageUrl: string | null;
  sals3Sku: string;
  supplierConnectionId: string;
  createdAt: Date;
};

/** Same rule as `SELLER_LINE_COLUMNS`, applied to the parcel row itself. */
const GROUP_COLUMNS = {
  id: fulfillmentGroups.id,
  orderId: fulfillmentGroups.orderId,
  packageId: fulfillmentGroups.packageId,
  shippingTier: fulfillmentGroups.shippingTier,
  supplierConnectionId: fulfillmentGroups.supplierConnectionId,
  destinationCountry: fulfillmentGroups.destinationCountry,
  logisticName: fulfillmentGroups.logisticName,
  shippingAmountMinor: fulfillmentGroups.shippingAmountMinor,
  currency: fulfillmentGroups.currency,
  status: fulfillmentGroups.status,
  cjOrderId: fulfillmentGroups.cjOrderId,
  lastErrorCode: fulfillmentGroups.lastErrorCode,
  parcelState: fulfillmentGroups.parcelState,
  trackingNumber: fulfillmentGroups.trackingNumber,
  lastSyncedAt: fulfillmentGroups.lastSyncedAt,
  createdAt: fulfillmentGroups.createdAt,
  updatedAt: fulfillmentGroups.updatedAt,
} as const;

type SellerGroupRow = {
  id: string;
  orderId: string;
  packageId: string;
  shippingTier: string | null;
  supplierConnectionId: string;
  destinationCountry: string;
  logisticName: string;
  shippingAmountMinor: bigint;
  currency: string;
  status: (typeof fulfillmentGroups.$inferSelect)['status'];
  cjOrderId: string | null;
  lastErrorCode: string | null;
  parcelState: string | null;
  trackingNumber: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The order columns this screen reads. Named for the same reason. */
const ORDER_COLUMNS = {
  id: sals3Orders.id,
  orderNumber: sals3Orders.orderNumber,
  checkoutIntentId: sals3Orders.checkoutIntentId,
  paymentStatus: sals3Orders.paymentStatus,
  amountMinor: sals3Orders.amountMinor,
  currency: sals3Orders.currency,
  createdAt: sals3Orders.createdAt,
} as const;

type SellerOrderRow = {
  id: string;
  orderNumber: string;
  checkoutIntentId: string;
  paymentStatus: (typeof sals3Orders.$inferSelect)['paymentStatus'];
  amountMinor: bigint;
  currency: string;
  createdAt: Date;
};

type ConnectionRow = {
  id: string;
  displayName: string;
  providerCode: string;
};

// --- Formatting ----------------------------------------------------------

const DATE_FORMAT = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDate(value: Date): string {
  return DATE_FORMAT.format(value);
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(value: Date): string {
  return DATE_TIME_FORMAT.format(value);
}

// --- Masking -------------------------------------------------------------

/**
 * Masking happens here, in the reader, so the plaintext never enters the page
 * payload at all.
 *
 * `contracts.ts` records why: shipping the real values alongside the mask and
 * hiding them in the client makes the mask cosmetic — view-source reads them
 * without anyone clicking, and the permission check becomes decoration. The
 * real values are only ever returned by `revealParcelContactForSeller`, which
 * the reveal action calls after its own `order:fulfill` check.
 */
function maskName(fullName: string): string {
  const trimmed = fullName.trim();

  if (trimmed.length <= 2) return trimmed === '' ? 'Buyer' : `${trimmed[0]}*`;

  return `${trimmed[0]}${'*'.repeat(Math.min(trimmed.length - 2, 4))}${trimmed[trimmed.length - 1]}`;
}

function maskPhone(phone: string | undefined): string {
  const trimmed = (phone ?? '').trim();

  if (trimmed === '') return 'No phone given';

  const tail = trimmed.slice(-3);

  return `${'*'.repeat(Math.max(trimmed.length - 3, 3))}${tail}`;
}

function maskAddress(address: {
  city: string;
  region: string;
  country: string;
}): string {
  return [address.city, address.region, address.country]
    .filter((part) => part.trim() !== '')
    .join(', ');
}

// --- Lifecycle -----------------------------------------------------------

function isParcelState(value: string): value is ParcelLifecycleState {
  return (PARCEL_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 * The fallback used when the status sync has never seen a group.
 *
 * `fulfillment_groups.parcel_state` is written only by `status-sync.ts`, so a
 * parcel created seconds ago has none. Falling back to the *fulfilment* status
 * keeps a new order visible in a lane instead of dropping it into no lane at
 * all — and every state in `PARCEL_LIFECYCLE_STATES` belongs to exactly one
 * lane, which `lanes.test.ts` enforces, so anything returned here is
 * guaranteed to render somewhere.
 */
function stateFromFulfillmentStatus(
  status: (typeof fulfillmentGroups.$inferSelect)['status'],
): ParcelLifecycleState {
  switch (status) {
    case 'PENDING':
      return 'FULFILLMENT_QUEUED';
    case 'CJ_ORDER_CREATED':
    case 'CJ_CART_CONFIRMED':
      return 'CJ_ORDER_CREATED';
    case 'CJ_PARENT_ORDER_CREATED':
      return 'CJ_PAYMENT_PENDING';
    case 'CJ_PAID':
      return 'FULFILLING';
    case 'FULFILLMENT_FAILED':
      return 'FULFILLMENT_FAILED';
    case 'AWAITING_SUPPLIER_FUNDS':
      return 'AWAITING_SUPPLIER_FUNDS';
    default:
      return 'FULFILLMENT_QUEUED';
  }
}

/**
 * A refund is an order-level fact and outranks whatever the parcel was doing.
 *
 * The money went back; a card still reading "Supplier preparing" would be
 * describing a shipment the seller has already been made whole for.
 */
function parcelStateOf(
  group: SellerGroupRow | null,
  order: SellerOrderRow,
): ParcelLifecycleState {
  if (order.paymentStatus === 'REFUNDED') return 'REFUNDED';

  // No group yet: the accept endpoint has written the order and the fulfilment
  // worker has not reached it. That is queued work, not a missing parcel.
  if (group === null) return 'FULFILLMENT_QUEUED';

  if (group.parcelState !== null && isParcelState(group.parcelState)) {
    return group.parcelState;
  }

  return stateFromFulfillmentStatus(group.status);
}

const STATUS_PRESENTATION: Record<
  ParcelLifecycleState,
  { label: string; detail: string; tone: ParcelStatus['tone'] }
> = {
  DRAFT: {
    label: 'Draft',
    detail: 'The buyer has not reached checkout yet.',
    tone: 'neutral',
  },
  CHECKOUT_PENDING: {
    label: 'Checkout pending',
    detail: 'The buyer is at checkout. Nothing is owed to a supplier yet.',
    tone: 'neutral',
  },
  PAYMENT_PENDING: {
    label: 'Payment pending',
    detail: 'Waiting for the payment to confirm.',
    tone: 'neutral',
  },
  PAID: {
    label: 'Paid',
    detail: 'Payment captured. The supplier order has not been placed yet.',
    tone: 'info',
  },
  FULFILLMENT_QUEUED: {
    label: 'To process',
    detail: 'Queued for the supplier. No action is needed from you.',
    tone: 'info',
  },
  CJ_ORDER_CREATED: {
    label: 'Supplier order created',
    detail: 'The supplier has the order and is awaiting payment.',
    tone: 'info',
  },
  CJ_PAYMENT_PENDING: {
    label: 'Supplier payment pending',
    detail: 'Paying the supplier from the connected wallet.',
    tone: 'info',
  },
  FULFILLING: {
    label: 'Supplier preparing',
    detail: 'The supplier is preparing this parcel for despatch.',
    tone: 'info',
  },
  SHIPPED: {
    label: 'Shipped',
    detail: 'Handed to the carrier. Tracking is below.',
    tone: 'info',
  },
  DELIVERED: {
    label: 'Delivered',
    detail: 'The carrier reported this parcel delivered.',
    tone: 'success',
  },
  PAYMENT_FAILED: {
    label: 'Payment failed',
    detail: 'The payment did not complete. Nothing was ordered.',
    tone: 'danger',
  },
  FULFILLMENT_FAILED: {
    label: 'Supplier order failed',
    detail:
      'The supplier order could not be placed. The fulfilment worker retries automatically.',
    tone: 'danger',
  },
  AWAITING_SUPPLIER_FUNDS: {
    label: 'Awaiting supplier funds',
    detail:
      'The connected supplier wallet does not have enough balance to pay for this parcel.',
    tone: 'warning',
  },
  CANCEL_REQUESTED: {
    label: 'Cancellation requested',
    detail: 'A cancellation was requested and is not resolved yet.',
    tone: 'warning',
  },
  CANCELLED: {
    label: 'Cancelled',
    detail: 'This parcel was cancelled.',
    tone: 'neutral',
  },
  DELIVERY_EXCEPTION: {
    label: 'Delivery exception',
    detail: 'The carrier reported a problem delivering this parcel.',
    tone: 'danger',
  },
  TRACKING_CONFLICT: {
    label: 'Tracking conflict',
    detail:
      'The carrier and the supplier disagree about this parcel. Neither source is being treated as correct.',
    tone: 'danger',
  },
  REFUND_PENDING: {
    label: 'Refund pending',
    detail: 'A refund is being processed for this order.',
    tone: 'warning',
  },
  REFUNDED: {
    label: 'Refunded',
    detail: 'This order was refunded to the buyer.',
    tone: 'neutral',
  },
  RETURN_IN_PROGRESS: {
    label: 'Return in progress',
    detail: 'The buyer is returning this parcel.',
    tone: 'warning',
  },
  RETURNED: {
    label: 'Returned',
    detail: 'This parcel was returned.',
    tone: 'neutral',
  },
};

const ATTENTION_BY_STATE: Partial<
  Record<ParcelLifecycleState, AttentionReason>
> = {
  AWAITING_SUPPLIER_FUNDS: 'funding',
  FULFILLMENT_FAILED: 'supplier-failure',
  TRACKING_CONFLICT: 'tracking-conflict',
  DELIVERY_EXCEPTION: 'delivery-exception',
};

/**
 * Sub-stage inside *To process*, dropshipper vocabulary only.
 *
 * `null` outside that lane rather than a catch-all value: `OrdersChipRow` is
 * handed one stage set and filters on it, so a stage on a shipped parcel would
 * put it under a chip describing work nobody can do to it.
 */
function stageOf(state: ParcelLifecycleState): ProcessStage | null {
  switch (state) {
    case 'PAID':
    case 'FULFILLMENT_QUEUED':
      return 'to-order';
    case 'CJ_ORDER_CREATED':
    case 'CJ_PAYMENT_PENDING':
      return 'to-pay';
    case 'FULFILLING':
      return 'supplier-preparing';
    default:
      return null;
  }
}

// --- Money ---------------------------------------------------------------

/**
 * The note that appears wherever a commission or a settlement figure would.
 *
 * One constant, used by both the list card and the detail statement, so the
 * two surfaces cannot drift into telling a seller different things about the
 * same missing system.
 */
const NO_COMMISSION_LEDGER =
  'Not configured. Sals3 commission and payouts are not set up for this account yet.';

const NO_SUPPLIER_SPEND_LEDGER =
  'Not configured. What this parcel cost you at the supplier is not recorded yet.';

function moneyOf(
  order: SellerOrderRow,
  parcelCount: number,
  parcelPaidMinor: number,
): ParcelMoney {
  return {
    buyerPaidLabel: formatParcelMoney(
      Number(order.amountMinor),
      order.currency,
    ),
    // Rail A. No ledger exists, so there is no number to put here and none is
    // derived from the buyer payment — see this module's header.
    commissionLabel: null,
    // Rail B. Deliberately not the freight the buyer paid: that is Rail A
    // money the buyer was charged, not money the seller owes their supplier.
    supplierCostLabel: null,
    supplierCostNote: NO_SUPPLIER_SPEND_LEDGER,
    wholeOrderNote:
      parcelCount > 1
        ? `Covers the whole order, all ${parcelCount} parcels. This parcel's share is ${formatParcelMoney(parcelPaidMinor, order.currency)}.`
        : null,
  };
}

// --- Assembly ------------------------------------------------------------

/**
 * The public address of a product page, or `null` when the product is not live.
 *
 * One reason for `null` now, not two: the storefront origin has a built-in
 * default (`lib/storefront/origin.ts`), so a deployment nobody has configured
 * still links correctly. What remains is the honest case — a product the
 * storefront would not serve gets no link rather than one that 404s.
 */
function storefrontUrlFor(slug: string | undefined): string | null {
  if (slug === undefined) return null;

  return `${storefrontOrigin()}/p/${slug}`;
}

function lineOf(
  row: SellerLineRow,
  arrivalWindow: string | null,
  publishedSlugs: Map<string, string>,
): ParcelLine {
  return {
    id: row.id,
    title: row.title,
    variation: row.variantLabel,
    quantity: row.quantity,
    imageUrl: row.imageUrl,
    acceptedOnLabel: `as ordered on ${formatDate(row.createdAt)}`,
    sku: row.sals3Sku,
    storefrontUrl: storefrontUrlFor(publishedSlugs.get(row.productId)),
    deliveryRangeLabel: arrivalWindow,
  };
}

function routeOf(
  group: SellerGroupRow,
  connection: ConnectionRow | undefined,
): ParcelRoute {
  return {
    kind: 'SUPPLIER_DROPSHIP',
    serviceLevel: isShippingTier(group.shippingTier)
      ? group.shippingTier
      : 'Standard delivery',
    carrier: group.logisticName,
    connection: {
      connectionId: group.supplierConnectionId,
      providerCode: connection?.providerCode ?? 'UNKNOWN',
      label: connection?.displayName ?? 'Supplier connection',
    },
    supplierOrderRef: group.cjOrderId,
    trackingNumber: group.trackingNumber,
  };
}

/**
 * Only navigation is offered.
 *
 * Every other control on this screen would touch a courier or a supplier
 * wallet, and no write path exists — `OrdersWorkspace` already answers those
 * with a toast saying so. Emitting them here as enabled buttons would move
 * that lie one layer earlier.
 */
function actionsOf(): ParcelAction[] {
  return [
    {
      id: 'details',
      label: 'Check details',
      variant: 'secondary',
      blockedReason: null,
    },
  ];
}

type ParcelInputs = {
  order: SellerOrderRow;
  group: SellerGroupRow | null;
  lines: SellerLineRow[];
  address: ReturnType<typeof readAddressSnapshot>;
  arrivalWindows: Map<string, string>;
  connections: Map<string, ConnectionRow>;
  parcelIndex: number;
  parcelCount: number;
  syntheticId: string;
  publishedSlugs: Map<string, string>;
};

/**
 * Builds one parcel card.
 *
 * `group === null` is the unassigned case: the order is paid and its lines
 * exist, but the fulfilment worker has not created a group yet. Those lines
 * still ride a card, for the same reason `buyer-read.ts` gives them a
 * synthetic package — **a paid order that is invisible is worse than an
 * untidy one**, and this screen's whole purpose is that every sale appears.
 */
function buildParcel(inputs: ParcelInputs): OrderParcel {
  const {
    order,
    group,
    lines,
    address,
    arrivalWindows,
    connections,
    parcelIndex,
    parcelCount,
    syntheticId,
    publishedSlugs,
  } = inputs;

  const state = parcelStateOf(group, order);

  const presentation = STATUS_PRESENTATION[state];
  const arrivalWindow =
    group === null ? null : (arrivalWindows.get(group.packageId) ?? null);

  const parcelPaidMinor = lines.reduce(
    (sum, row) => sum + Number(row.unitAmountMinor) * row.quantity,
    0,
  );

  return {
    id: group?.id ?? syntheticId,
    orderRef: order.orderNumber,
    parcelIndex,
    parcelCount,
    buyerLabel:
      address === null
        ? 'Buyer'
        : `${maskName(address.fullName)} · ${address.city}`,
    // Nothing stores a buyer message today. Null rather than an empty string,
    // so the card renders no note instead of an empty one.
    buyerMessage: null,
    lines: lines.map((row) => lineOf(row, arrivalWindow, publishedSlugs)),
    money: moneyOf(order, parcelCount, parcelPaidMinor),
    status: {
      label: presentation.label,
      detail:
        group !== null && state === 'FULFILLMENT_FAILED' && group.lastErrorCode
          ? `${presentation.detail} Last error: ${group.lastErrorCode}.`
          : presentation.detail,
      tone: presentation.tone,
    },
    state,
    attentionReason: ATTENTION_BY_STATE[state] ?? null,
    stage: stageOf(state),
    route:
      group === null
        ? {
            kind: 'SUPPLIER_DROPSHIP',
            serviceLevel: 'Chosen at checkout',
            carrier: null,
            connection: {
              connectionId: lines[0]?.supplierConnectionId ?? 'unknown',
              providerCode:
                connections.get(lines[0]?.supplierConnectionId ?? '')
                  ?.providerCode ?? 'UNKNOWN',
              label:
                connections.get(lines[0]?.supplierConnectionId ?? '')
                  ?.displayName ?? 'Supplier connection',
            },
            supplierOrderRef: null,
            trackingNumber: null,
          }
        : routeOf(group, connections.get(group.supplierConnectionId)),
    actions: actionsOf(),
    // Selection drives label printing, and a dropship parcel has no label for
    // the seller to print because the seller never handles it. Every parcel is
    // dropship today, so nothing is selectable — a correctness rule, and the
    // reason the bulk bar does not appear.
    selectable: false,
    channel:
      group === null ? 'Sals3' : `Sals3 ${group.destinationCountry}`.trim(),
    orderedAt: order.createdAt.toISOString(),
    // Nothing promises a despatch date for a dropship parcel: the supplier
    // sets its own pace and Sals3 has made the buyer no cutoff commitment.
    shipBy: null,
    proceedsMinor: parcelPaidMinor,
    currency: order.currency,
  };
}

async function loadConnections(
  executor: DbExecutor,
  connectionIds: string[],
): Promise<Map<string, ConnectionRow>> {
  if (connectionIds.length === 0) return new Map();

  const rows = await executor
    .select({
      id: supplierConnections.id,
      displayName: supplierConnections.displayName,
      providerCode: supplierProviders.code,
    })
    .from(supplierConnections)
    .innerJoin(
      supplierProviders,
      eq(supplierProviders.id, supplierConnections.providerId),
    )
    .where(inArray(supplierConnections.id, connectionIds));

  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Every parcel this seller's connections are fulfilling, newest order first.
 *
 * The seller scope is applied twice on purpose, because there are two ways a
 * line reaches this screen: through its group's connection (the normal case)
 * and through its own connection while it has no group yet. Both predicates
 * name `supplier_connections.seller_account_id`; neither is a post-fetch pass.
 */
/**
 * Whether this value can possibly identify a seller account.
 *
 * `seller_account_id` is a `uuid` column, so a non-UUID cannot match a row —
 * but Postgres does not answer "no rows", it raises `22P02
 * invalid_text_representation` and the page 500s.
 *
 * That is reachable today. `resolvePortalSession` gives a signed-in user with
 * no seller account the literal `sellerId: 'system'`, and it only redirects to
 * `/auth/pending` for the roles in `SELLER_ROLES` — which does not include
 * `admin`, and `admin` holds every permission including `order:read`. So an
 * administrator with no seller account of their own could open Orders and meet
 * a crash.
 *
 * Refusing here rather than in the page keeps the answer the same for all
 * three entry points, and keeps it **fail-closed**: an unrecognisable tenant
 * gets nothing, which is the only safe direction for a predicate whose whole
 * job is to separate one seller's orders from another's.
 */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identifiesASeller(sellerAccountId: string): boolean {
  return UUID_SHAPE.test(sellerAccountId.trim());
}

/**
 * Shapes parcels for an explicit set of orders, seller-scoped throughout.
 *
 * Split out from `listOrderParcelsForSeller` so the detail and reveal paths can
 * assemble **one** order without inheriting the list's `MAX_ORDERS` ceiling.
 * That ceiling is right for a list and was wrong for everything else: a parcel
 * belonging to the 201st-most-recent order was not slow to open, it answered
 * 404 — a real order, owned by the seller asking, reported as not existing.
 *
 * The seller predicate stays in every `WHERE` here regardless of how the ids
 * were chosen, so a caller that resolves ids by some other route cannot widen
 * the boundary by accident.
 */
async function assembleParcelsForOrders(
  executor: DbExecutor,
  sellerAccountId: string,
  orderIds: string[],
): Promise<OrderParcel[]> {
  if (orderIds.length === 0) return [];

  const [orders, groups, lines] = await Promise.all([
    executor
      .select(ORDER_COLUMNS)
      .from(sals3Orders)
      .where(inArray(sals3Orders.id, orderIds))
      .orderBy(desc(sals3Orders.createdAt)),
    executor
      .select(GROUP_COLUMNS)
      .from(fulfillmentGroups)
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, fulfillmentGroups.supplierConnectionId),
      )
      .where(
        and(
          inArray(fulfillmentGroups.orderId, orderIds),
          eq(supplierConnections.sellerAccountId, sellerAccountId),
        ),
      )
      .orderBy(asc(fulfillmentGroups.packageId)),
    executor
      .select(SELLER_LINE_COLUMNS)
      .from(sals3OrderLines)
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, sals3OrderLines.supplierConnectionId),
      )
      .where(
        and(
          inArray(sals3OrderLines.orderId, orderIds),
          eq(supplierConnections.sellerAccountId, sellerAccountId),
        ),
      )
      .orderBy(asc(sals3OrderLines.createdAt)),
  ]);

  const sellerGroups = groups;
  const sellerLines = lines;

  const intents = await executor
    .select({
      id: checkoutIntents.id,
      addressSnapshot: checkoutIntents.addressSnapshot,
      shippingSelectionSnapshot: checkoutIntents.shippingSelectionSnapshot,
    })
    .from(checkoutIntents)
    .where(
      inArray(
        checkoutIntents.id,
        orders.map((order) => order.checkoutIntentId),
      ),
    );

  const intentById = new Map(intents.map((intent) => [intent.id, intent]));
  // One lookup for every product on the page, resolved through the storefront's
  // own publication gate rather than a second copy of it here.
  const publishedSlugs = await listPublishedSlugsForProducts(
    [...new Set(sellerLines.map((line) => line.productId))],
    executor,
  );
  const connections = await loadConnections(executor, [
    ...new Set([
      ...sellerGroups.map((group) => group.supplierConnectionId),
      ...sellerLines.map((line) => line.supplierConnectionId),
    ]),
  ]);

  return orders.flatMap((order) => {
    const intent = intentById.get(order.checkoutIntentId);
    const address = intent === undefined ? null : readAddressSnapshot(intent);
    const arrivalWindows =
      intent === undefined
        ? new Map<string, string>()
        : arrivalWindowsByPackage(intent);

    const orderGroups = sellerGroups.filter(
      (group) => group.orderId === order.id,
    );
    const orderLines = sellerLines.filter((line) => line.orderId === order.id);
    const orphanLines = orderLines.filter(
      (line) =>
        line.fulfillmentGroupId === null ||
        !orderGroups.some((group) => group.id === line.fulfillmentGroupId),
    );

    const parcelCount = orderGroups.length + (orphanLines.length > 0 ? 1 : 0);

    const parcels = orderGroups.map((group, index) =>
      buildParcel({
        order,
        group,
        lines: orderLines.filter(
          (line) => line.fulfillmentGroupId === group.id,
        ),
        address,
        arrivalWindows,
        connections,
        parcelIndex: index + 1,
        parcelCount,
        syntheticId: group.id,
        publishedSlugs,
      }),
    );

    if (orphanLines.length > 0) {
      parcels.push(
        buildParcel({
          order,
          group: null,
          lines: orphanLines,
          address,
          arrivalWindows,
          connections,
          parcelIndex: parcelCount,
          parcelCount,
          syntheticId: `unassigned:${order.id}`,
          publishedSlugs,
        }),
      );
    }

    return parcels;
  });
}

/**
 * Every parcel this seller's connections are fulfilling, newest order first.
 *
 * Capped at `MAX_ORDERS`, and the list page discloses the cap when it is
 * reached. Only the *list* is capped: the detail and reveal paths resolve one
 * order directly, so an old parcel stays openable.
 */
export async function listOrderParcelsForSeller(
  sellerAccountId: string,
  options: { executor?: DbExecutor } = {},
): Promise<OrderParcel[]> {
  if (!identifiesASeller(sellerAccountId)) return [];

  const executor = options.executor ?? getDb();

  // The set of orders this seller has any stake in. Scoped through the line's
  // own connection so an order whose group has not been created yet is still
  // found — the exact case that would otherwise hide a brand-new sale.
  const orderIdRows = await executor
    .selectDistinct({
      orderId: sals3OrderLines.orderId,
      createdAt: sals3Orders.createdAt,
    })
    .from(sals3OrderLines)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, sals3OrderLines.supplierConnectionId),
    )
    .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
    .where(eq(supplierConnections.sellerAccountId, sellerAccountId))
    .orderBy(desc(sals3Orders.createdAt))
    .limit(MAX_ORDERS);

  return assembleParcelsForOrders(
    executor,
    sellerAccountId,
    orderIdRows.map((row) => row.orderId),
  );
}

/** A parcel id names an `unassigned:` bundle when it carries this prefix. */
const UNASSIGNED_PREFIX = 'unassigned:';

/**
 * The order a parcel belongs to, or `null` when it is not this seller's.
 *
 * **This is the ownership check**, and it is one query rather than a scan of
 * the seller's recent orders. Both branches name `seller_account_id` in the
 * `WHERE`, so "no such parcel" and "not yours" are the same answer for the
 * same reason the list is scoped in SQL — and they stay indistinguishable to
 * the caller, because holding a parcel id is not authorisation.
 */
async function resolveOwnedOrderId(
  executor: DbExecutor,
  parcelId: string,
  sellerAccountId: string,
): Promise<string | null> {
  if (parcelId.startsWith(UNASSIGNED_PREFIX)) {
    const orderId = parcelId.slice(UNASSIGNED_PREFIX.length);

    // A synthetic id is caller-supplied text, so it reaches a `uuid` column
    // and would raise 22P02 rather than matching nothing.
    if (!identifiesASeller(orderId)) return null;

    // Owning the *bundle* means holding an ungrouped line on that order. The
    // predicate is the same one that put the bundle in the list.
    const rows = await executor
      .select({ orderId: sals3OrderLines.orderId })
      .from(sals3OrderLines)
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, sals3OrderLines.supplierConnectionId),
      )
      .where(
        and(
          eq(sals3OrderLines.orderId, orderId),
          isNull(sals3OrderLines.fulfillmentGroupId),
          eq(supplierConnections.sellerAccountId, sellerAccountId),
        ),
      )
      .limit(1);

    return rows[0]?.orderId ?? null;
  }

  if (!identifiesASeller(parcelId)) return null;

  const rows = await executor
    .select({ orderId: fulfillmentGroups.orderId })
    .from(fulfillmentGroups)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, fulfillmentGroups.supplierConnectionId),
    )
    .where(
      and(
        eq(fulfillmentGroups.id, parcelId),
        eq(supplierConnections.sellerAccountId, sellerAccountId),
      ),
    )
    .limit(1);

  return rows[0]?.orderId ?? null;
}

/**
 * This parcel and its siblings, without touching the list's ceiling.
 *
 * `identifiesASeller` doubles as the uuid-shape guard here: both a parcel id
 * and an order id are uuids, and both reach `uuid` columns.
 */
async function ownedParcelsForParcel(
  executor: DbExecutor,
  parcelId: string,
  sellerAccountId: string,
): Promise<OrderParcel[]> {
  if (!identifiesASeller(sellerAccountId)) return [];

  const orderId = await resolveOwnedOrderId(
    executor,
    parcelId,
    sellerAccountId,
  );

  if (orderId === null) return [];

  return assembleParcelsForOrders(executor, sellerAccountId, [orderId]);
}

// --- Detail --------------------------------------------------------------

function settlementOf(
  order: SellerOrderRow,
  parcelPaidMinor: number,
  shippingMinor: number,
): SettlementStatement {
  const notConfigured = (label: string, hint: string): MoneyLine => ({
    label,
    valueLabel: 'Not configured',
    hint,
    emphasis: 'sub',
  });

  return {
    groups: [
      {
        heading: 'What the buyer paid',
        lines: [
          {
            label: 'Items',
            valueLabel: formatParcelMoney(parcelPaidMinor, order.currency),
            hint: 'The ordered lines on this parcel, at the price frozen when the order was accepted.',
            emphasis: 'sub',
          },
          {
            label: 'Delivery',
            valueLabel: formatParcelMoney(shippingMinor, order.currency),
            hint: 'The freight the buyer was quoted and charged for this parcel.',
            emphasis: 'sub',
          },
        ],
      },
      {
        heading: 'Deductions',
        lines: [
          notConfigured('Sals3 commission', NO_COMMISSION_LEDGER),
          notConfigured(
            'Payment processing',
            'Not configured. Payment costs are not attributed per order yet.',
          ),
        ],
      },
    ],
    estimatedIncome: {
      label: 'Estimated income',
      valueLabel: 'Not configured',
      hint: NO_COMMISSION_LEDGER,
      emphasis: 'accent',
    },
    finalAmount: {
      label: 'Final amount',
      valueLabel: 'Not configured',
      hint: 'A final payout amount needs a commission ledger and a payout run. Neither exists yet.',
      emphasis: 'total',
    },
    buyerPayment: {
      label: 'Buyer payment',
      valueLabel: formatParcelMoney(Number(order.amountMinor), order.currency),
      hint: 'The whole order, as charged by Stripe. It is not money paid to you.',
      emphasis: 'total',
    },
    buyerPaymentLines: [
      {
        label: 'This parcel',
        valueLabel: formatParcelMoney(
          parcelPaidMinor + shippingMinor,
          order.currency,
        ),
        hint: null,
        emphasis: 'sub',
      },
    ],
    adjustments: [],
  };
}

function supplierSpendOf(connectionLabel: string): SupplierSpend {
  return {
    lines: [
      {
        label: 'Supplier order total',
        valueLabel: 'Not configured',
        hint: NO_SUPPLIER_SPEND_LEDGER,
        emphasis: 'sub',
      },
    ],
    totalLabel: 'Not configured',
    accountLabel: connectionLabel,
    // A wallet balance would be a live CJ call on a page render, which the
    // operating contract's §9 call budget forbids outright.
    walletStateLabel: null,
  };
}

/**
 * Counted facts about whether this parcel can actually be fulfilled.
 *
 * Only facts the row already holds. No score, no percentage, and nothing that
 * would need a supplier call to answer.
 */
function riskFactsOf(
  group: SellerGroupRow | null,
  /**
   * The parcel's own lines, taken from the seller-scoped list rather than
   * re-queried.
   *
   * This used to re-read `sals3_order_lines` by `order_id` with **no seller
   * predicate** and narrow the result with a JavaScript `.filter()` — the
   * exact thing this module's header says it never does. On a split order
   * where two sellers each hold ungrouped lines, the `unassigned` parcel
   * counted the other seller's lines as its own: a wrong number, and a small
   * cross-tenant read.
   *
   * The fix is not a `WHERE` clause, it is deleting the query. `parcel.lines`
   * is already this parcel's lines, already scoped, already grouped — so the
   * boundary cannot be re-derived incorrectly because there is nothing left to
   * re-derive, and the detail read costs one statement less.
   */
  lines: readonly ParcelLine[],
  events: TrackingEvent[],
): FulfilmentRiskFact[] {
  const exceptions = events.filter((event) => event.isException).length;

  return [
    {
      id: 'lines',
      label: 'Ordered lines',
      value: `${lines.length}`,
      tone: 'neutral',
    },
    {
      id: 'supplier-order',
      label: 'Supplier order',
      value: group?.cjOrderId ? 'Placed' : 'Not placed yet',
      tone: group?.cjOrderId ? 'neutral' : 'warning',
    },
    {
      id: 'tracking',
      label: 'Tracking number',
      value: group?.trackingNumber ?? 'Not issued yet',
      // Neutral either way: a parcel with no waybill yet is the normal state
      // for most of its life, not a warning. The branch that used to be here
      // returned 'neutral' from both arms.
      tone: 'neutral',
    },
    {
      id: 'exceptions',
      label: 'Carrier exceptions',
      value: `${exceptions}`,
      tone: exceptions > 0 ? 'danger' : 'neutral',
    },
  ];
}

function lifecycleEventsOf(
  order: SellerOrderRow,
  group: SellerGroupRow | null,
): LifecycleEvent[] {
  const events: LifecycleEvent[] = [
    {
      id: 'accepted',
      label: 'Order accepted, payment captured',
      occurredAtLabel: formatDateTime(order.createdAt),
    },
  ];

  if (group === null) return events;

  events.push({
    id: 'group-created',
    label: 'Parcel created for the supplier',
    occurredAtLabel: formatDateTime(group.createdAt),
  });

  if (group.cjOrderId !== null) {
    events.push({
      id: 'supplier-order',
      label: 'Supplier order placed',
      occurredAtLabel: formatDateTime(group.updatedAt),
    });
  }

  if (group.lastSyncedAt !== null) {
    events.push({
      id: 'synced',
      label: 'Supplier status last checked',
      occurredAtLabel: formatDateTime(group.lastSyncedAt),
    });
  }

  return events;
}

/**
 * One parcel in full, or `null`.
 *
 * `null` covers both "no such parcel" and "not yours", and it must keep
 * covering both: distinguishing them would let anyone holding a parcel id
 * learn whether it exists. The page turns this into `notFound()`.
 */
export async function findOrderParcelDetailForSeller(
  parcelId: string,
  sellerAccountId: string,
  canRevealContact: boolean,
  options: { executor?: DbExecutor } = {},
): Promise<ParcelDetail | null> {
  const executor = options.executor ?? getDb();
  // One order, not the seller's recent 200. Before this, a parcel older than
  // the list's ceiling answered 404 rather than opening.
  const parcels = await ownedParcelsForParcel(
    executor,
    parcelId,
    sellerAccountId,
  );
  const parcel = parcels.find((row) => row.id === parcelId);

  if (parcel === undefined) return null;

  const groupRows = parcelId.startsWith(UNASSIGNED_PREFIX)
    ? []
    : await executor
        .select(GROUP_COLUMNS)
        .from(fulfillmentGroups)
        .where(eq(fulfillmentGroups.id, parcelId))
        .limit(1);

  const group = groupRows[0] ?? null;

  const orderRows = await executor
    .select(ORDER_COLUMNS)
    .from(sals3Orders)
    .where(eq(sals3Orders.orderNumber, parcel.orderRef))
    .limit(1);

  const order = orderRows[0];

  if (order === undefined) return null;

  const intentRows = await executor
    .select({
      id: checkoutIntents.id,
      addressSnapshot: checkoutIntents.addressSnapshot,
    })
    .from(checkoutIntents)
    .where(eq(checkoutIntents.id, order.checkoutIntentId))
    .limit(1);

  const address =
    intentRows[0] === undefined ? null : readAddressSnapshot(intentRows[0]);

  const eventRows =
    group === null
      ? []
      : await executor
          .select({
            id: parcelTrackingEvents.id,
            source: parcelTrackingEvents.source,
            label: parcelTrackingEvents.label,
            occurredAt: parcelTrackingEvents.occurredAt,
            isException: parcelTrackingEvents.isException,
          })
          .from(parcelTrackingEvents)
          .where(eq(parcelTrackingEvents.fulfillmentGroupId, group.id))
          .orderBy(asc(parcelTrackingEvents.occurredAt));

  const trackingEvents: TrackingEvent[] = eventRows.map((event) => ({
    id: event.id,
    label: event.label,
    occurredAtLabel: formatDateTime(event.occurredAt),
    source: event.source as TrackingEvent['source'],
    isException: event.isException,
  }));

  const buyer: BuyerIdentity = {
    maskedName: address === null ? 'Buyer' : maskName(address.fullName),
    maskedPhone: maskPhone(address?.phone),
    maskedAddress:
      address === null ? 'No address on this order' : maskAddress(address),
    canReveal: canRevealContact && address !== null,
    addressLabel: address === null ? null : address.country,
  };

  const siblings = parcels
    .filter((row) => row.orderRef === parcel.orderRef && row.id !== parcel.id)
    .map((row) => ({
      id: row.id,
      indexLabel: `Parcel ${row.parcelIndex} of ${row.parcelCount}`,
      routeLabel: row.route.carrier ?? 'Delivery option chosen at checkout',
    }));

  return {
    parcel,
    // Empty, not `parcel.actions`. The list's only action is "Check details",
    // which on this page is a button to the page you are already reading — and
    // its handler toasted "not wired to a backend yet", which was untrue of the
    // one action that *is* wired. Nothing else exists to offer: every real next
    // step here touches a courier or a supplier wallet, and none of that is
    // built.
    actions: [],
    buyer,
    riskFacts: riskFactsOf(group, parcel.lines, trackingEvents),
    // No write path exists for a seller note, and a read-only null renders
    // nothing rather than an empty box implying one can be typed.
    sellerNote: null,
    siblings,
    // Own-stock only, and nothing is own-stock: Sals3 holds no carrier
    // relationship for a dropship parcel.
    courierContactLabel: null,
    trackingEvents,
    lifecycleEvents: lifecycleEventsOf(order, group),
    settlement: settlementOf(
      order,
      parcel.proceedsMinor,
      group === null ? 0 : Number(group.shippingAmountMinor),
    ),
    supplierSpend: supplierSpendOf(
      parcel.route.kind === 'SUPPLIER_DROPSHIP'
        ? parcel.route.connection.label
        : 'Supplier connection',
    ),
  };
}

/**
 * The buyer's real contact details.
 *
 * Separate from the detail read on purpose: the plaintext must never be
 * reachable from the call that renders the page, or it lands in the page
 * payload where the masking above becomes decoration. Only the reveal server
 * action calls this, after its own `order:fulfill` check — and the seller
 * scope is re-applied here rather than trusted from that caller.
 */
export async function revealParcelContactForSeller(
  parcelId: string,
  sellerAccountId: string,
  options: { executor?: DbExecutor } = {},
): Promise<RevealedContact | null> {
  const executor = options.executor ?? getDb();
  // Same one-order resolution as the detail read, and the same ownership
  // check: the reveal must not become the one path with its own idea of who
  // owns a parcel.
  const parcels = await ownedParcelsForParcel(
    executor,
    parcelId,
    sellerAccountId,
  );
  const parcel = parcels.find((row) => row.id === parcelId);

  if (parcel === undefined) return null;

  const orderRows = await executor
    .select({ checkoutIntentId: sals3Orders.checkoutIntentId })
    .from(sals3Orders)
    .where(eq(sals3Orders.orderNumber, parcel.orderRef))
    .limit(1);

  const order = orderRows[0];

  if (order === undefined) return null;

  const intentRows = await executor
    .select({
      id: checkoutIntents.id,
      addressSnapshot: checkoutIntents.addressSnapshot,
    })
    .from(checkoutIntents)
    .where(eq(checkoutIntents.id, order.checkoutIntentId))
    .limit(1);

  const address =
    intentRows[0] === undefined ? null : readAddressSnapshot(intentRows[0]);

  if (address === null) return null;

  return {
    name: address.fullName,
    phone: address.phone ?? 'No phone given',
    address: [
      address.addressLine1,
      address.addressLine2,
      address.city,
      address.region,
      address.postalCode,
      address.country,
    ]
      .filter((part) => part !== undefined && part.trim() !== '')
      .join(', '),
  };
}
