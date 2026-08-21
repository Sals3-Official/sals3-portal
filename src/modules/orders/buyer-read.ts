import 'server-only';

import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import getDb, { type DbExecutor } from '@/lib/db/client';
import {
  listLineReviewStates,
  type LineReviewState,
} from '@/modules/reviews/eligibility';
import {
  listingSnapshotSchema,
  type ListingSnapshot,
} from '@/modules/checkout/listing-snapshot';
import {
  checkoutIntents,
  fulfillmentGroups,
  parcelTrackingEvents,
  sals3OrderLines,
  sals3Orders,
  type FulfillmentGroupRow,
  type Sals3OrderRow,
} from '@/lib/db/schema';
import {
  PARCEL_LIFECYCLE_STATES,
  type ParcelLifecycleState,
} from './contracts';

/**
 * The buyer's view of their own orders, read from the database and shaped for
 * `GET /api/storefront/orders*`.
 *
 * ## The authorisation shape
 *
 * Every read takes the buyer's email first and filters on
 * `sals3_orders.buyer_email` inside the query. There is no "read by number"
 * without the email: an order another account owns is indistinguishable from
 * one that does not exist, which is the same posture the storefront's own
 * pages hold (holding an order number is not authorisation).
 *
 * ## What deliberately never leaves this module
 *
 * Supplier connection ids, CJ order/shipment/pay ids, `supplierStatusRaw`, and
 * every other sourcing identifier. The buyer payload names a carrier
 * (`logisticName`) and a tracking number, nothing else — ADR-004 §6 keeps raw
 * supplier vocabulary off buyer surfaces, and the storefront's own tests grep
 * its rendered output for leaks.
 *
 * ## Money is minor units + currency
 *
 * Formatting belongs to the storefront's `formatMoney`, which already owns the
 * `US$` conventions. This API returns integers so no rounding decision is made
 * twice.
 */

/**
 * The stored snapshot, or nothing at all.
 *
 * `safeParse`, never `parse`: this is a buyer looking at an order they have
 * already paid for, and a snapshot written by a newer deployment — or an older
 * one missing a field added since — must degrade to the three frozen columns
 * rather than fail the page. Spread as an optional key so "not captured" and
 * "captured and empty" stay distinguishable to the consumer.
 */
function frozenListing(
  stored: unknown,
): { listing: ListingSnapshot } | Record<string, never> {
  if (stored === null || stored === undefined) return {};

  const parsed = listingSnapshotSchema.safeParse(stored);

  return parsed.success ? { listing: parsed.data } : {};
}

/**
 * Exactly the line columns a buyer's own order page is allowed to read.
 *
 * Everything absent here is absent on purpose: `supplier_connection_id`,
 * `external_product_id`, `external_variant_id`, and `external_sku` are supplier
 * facts ADR-004 §6 keeps out of a buyer payload, and the previous bare
 * `.select()` fetched all four on every request and relied on the projection
 * below to drop them.
 */
const BUYER_LINE_COLUMNS = {
  id: sals3OrderLines.id,
  orderId: sals3OrderLines.orderId,
  fulfillmentGroupId: sals3OrderLines.fulfillmentGroupId,
  title: sals3OrderLines.title,
  variantLabel: sals3OrderLines.variantLabel,
  quantity: sals3OrderLines.quantity,
  unitAmountMinor: sals3OrderLines.unitAmountMinor,
  imageUrl: sals3OrderLines.imageUrl,
  listingSnapshot: sals3OrderLines.listingSnapshot,
  createdAt: sals3OrderLines.createdAt,
} as const;

export type BuyerOrderLinePayload = {
  id: string;
  title: string;
  variantLabel: string | null;
  quantity: number;
  unitAmountMinor: number;
  imageUrl: string | null;
  acceptedAt: string;
  /**
   * The listing as it was when this order was placed — the option axes in the
   * seller's own words, the gallery, the description, the specifications, the
   * category and the brand.
   *
   * Absent on orders accepted before the snapshot existed, and absent when the
   * stored document cannot be read by this deployment. A consumer must treat
   * absence as "we do not have this for this order" and fall back to `title`,
   * `variantLabel` and `imageUrl`, which are frozen per line regardless.
   */
  listing?: ListingSnapshot;
  /**
   * Whether this buyer can write a review of this line right now — the line's
   * own package delivered, inside the window, and not already reviewed.
   *
   * Resolved by `modules/reviews/eligibility.ts`, which is the single place
   * that decides it. Carried on the order payload rather than fetched per row
   * by the storefront: the gate is per line, and a query per row on an order
   * page is the N+1 the code rules forbid.
   */
  reviewable: boolean;
  /** This buyer's own review of this line, when they have written one. */
  review?: { id: string; rating: number; createdAt: string };
};

export type BuyerTrackingEventPayload = {
  id: string;
  source: 'CARRIER' | 'SUPPLIER' | 'OPERATIONS';
  label: string;
  occurredAt: string;
  isException: boolean;
};

export type BuyerPackagePayload = {
  packageId: string;
  carrier: string;
  trackingNumber: string | null;
  /** ADR-004 §2 state; null when the sync has never reached this group. */
  parcelState: ParcelLifecycleState | null;
  /** Worker-side status, for groups the sync has not stamped yet. */
  fulfillmentStatus: string;
  shippingAmountMinor: number;
  /** The freight quote's `arrivalTime` captured at checkout, e.g. `12-18`. */
  arrivalDays: string | null;
  lines: BuyerOrderLinePayload[];
  events: BuyerTrackingEventPayload[];
};

export type BuyerShipToPayload = {
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  email: string;
  phone: string | null;
};

export type BuyerOrderPayload = {
  orderNumber: string;
  placedAt: string;
  paymentStatus: 'PAID' | 'REFUNDED' | 'DISPUTED';
  currency: string;
  amountTotalMinor: number;
  stripeCheckoutSessionId: string;
  packages: BuyerPackagePayload[];
  shipTo: BuyerShipToPayload;
};

const addressSnapshotSchema = z.object({
  email: z.string(),
  fullName: z.string(),
  phone: z.string().optional(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  region: z.string(),
  postalCode: z.string(),
  country: z.string(),
});

const shippingSelectionSnapshotSchema = z.object({
  packageSelections: z.array(
    z.object({
      packageId: z.string(),
      arrivalTime: z.string().optional(),
    }),
  ),
});

/** Hard ceiling on orders returned for one buyer. */
const MAX_ORDERS = 200;

function isParcelState(value: string): value is ParcelLifecycleState {
  return (PARCEL_LIFECYCLE_STATES as readonly string[]).includes(value);
}

function shipToOf(intent: {
  addressSnapshot: unknown;
}): BuyerShipToPayload | null {
  const parsed = addressSnapshotSchema.safeParse(intent.addressSnapshot);

  if (!parsed.success) return null;

  return {
    name: parsed.data.fullName,
    addressLine1: parsed.data.addressLine1,
    addressLine2: parsed.data.addressLine2 ?? null,
    city: parsed.data.city,
    region: parsed.data.region,
    postalCode: parsed.data.postalCode,
    country: parsed.data.country,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
  };
}

function arrivalDaysByPackage(intent: {
  shippingSelectionSnapshot: unknown;
}): Map<string, string> {
  const parsed = shippingSelectionSnapshotSchema.safeParse(
    intent.shippingSelectionSnapshot,
  );

  if (!parsed.success) return new Map();

  return new Map(
    parsed.data.packageSelections
      .filter((row) => row.arrivalTime !== undefined && row.arrivalTime !== '')
      .map((row) => [row.packageId, row.arrivalTime as string]),
  );
}

/**
 * Folds one line's review state into the payload shape.
 *
 * `reviewable` is always present (a boolean the consumer can branch on without
 * an existence check), while `review` is omitted rather than `null` — the same
 * rule the rest of this payload follows, where an absent key says "there is no
 * such thing" and a present one carries a real value.
 *
 * A line missing from the map is not reviewable. That is the safe direction: a
 * review the buyer is not entitled to write would be refused by
 * `resolveReviewableLine` anyway, so the worst this can do is hide a control
 * that would have worked, never offer one that writes something invalid.
 */
function reviewStateOf(
  states: Map<string, LineReviewState>,
  lineId: string,
): Pick<BuyerOrderLinePayload, 'reviewable' | 'review'> {
  const state = states.get(lineId);

  if (state === undefined) return { reviewable: false };

  return {
    reviewable: state.reviewable,
    ...(state.review === null ? {} : { review: state.review }),
  };
}

/**
 * Review state for every line on the page — and never a reason this page fails.
 *
 * ## Why this read is allowed to fail and the others are not
 *
 * An order page is a receipt. A buyer who has paid is entitled to read what they
 * bought, what it cost and where it is, and none of that depends on whether they
 * can also leave a star rating. So a failure here costs the review controls and
 * nothing else.
 *
 * This is not defensive noise. `sals3_product_reviews` reaches a deployed
 * database through a `workflow_dispatch`, not through the deploy, so there is a
 * real window in which this table does not exist while this code does — and
 * without this catch a missing relation (`42P01`) would take down order history
 * for every buyer, which is exactly the shape of the PR #102 outage.
 *
 * `readOrUnavailable` is deliberately not used and deliberately not widened: it
 * treats only connection-class errors as unavailable and rethrows the rest,
 * which is correct, because a portal-wide helper that swallowed
 * `undefined_table` would hide genuine schema drift everywhere. The narrow catch
 * belongs at the one call site that has decided it can live without the answer.
 */
async function readReviewStates(
  executor: DbExecutor,
  buyerEmail: string,
  orderIds: string[],
): Promise<Map<string, LineReviewState>> {
  try {
    const states = await listLineReviewStates(
      { buyerEmail, orderIds },
      executor,
    );

    return new Map(states.map((state) => [state.orderLineId, state]));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] buyer review state unavailable', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    // Empty, not partial: `reviewStateOf` reads a miss as "not reviewable",
    // which hides a control that would have worked rather than offering one
    // that cannot.
    return new Map();
  }
}

async function assembleOrders(
  executor: DbExecutor,
  orders: Sals3OrderRow[],
  buyerEmail: string,
): Promise<BuyerOrderPayload[]> {
  if (orders.length === 0) return [];

  const orderIds = orders.map((order) => order.id);
  const intentIds = orders.map((order) => order.checkoutIntentId);

  const [groups, lines, intents] = await Promise.all([
    executor
      .select()
      .from(fulfillmentGroups)
      .where(inArray(fulfillmentGroups.orderId, orderIds))
      .orderBy(asc(fulfillmentGroups.packageId)),
    executor
      // Named columns, not a bare `.select()`. That expands to every column the
      // Drizzle schema declares, so a schema gaining a column would change this
      // query's SQL — and a deployment carrying a column production has not
      // migrated yet would fail every buyer's order page with
      // `column ... does not exist`. Naming them also keeps supplier-only
      // columns (`supplier_connection_id`, the CJ ids) out of a payload that
      // must never carry them (ADR-004 §6).
      .select(BUYER_LINE_COLUMNS)
      .from(sals3OrderLines)
      .where(inArray(sals3OrderLines.orderId, orderIds))
      .orderBy(asc(sals3OrderLines.createdAt)),
    executor
      .select({
        id: checkoutIntents.id,
        addressSnapshot: checkoutIntents.addressSnapshot,
        shippingSelectionSnapshot: checkoutIntents.shippingSelectionSnapshot,
      })
      .from(checkoutIntents)
      .where(inArray(checkoutIntents.id, intentIds)),
  ]);

  const groupIds = groups.map((group) => group.id);
  const events =
    groupIds.length === 0
      ? []
      : await executor
          .select()
          .from(parcelTrackingEvents)
          .where(inArray(parcelTrackingEvents.fulfillmentGroupId, groupIds))
          .orderBy(asc(parcelTrackingEvents.occurredAt));

  const intentById = new Map(intents.map((intent) => [intent.id, intent]));

  // One query for every line on the page, keyed by line id. The eligibility
  // rules live in `modules/reviews/eligibility.ts` and are not restated here —
  // this reader consumes the answer, it does not decide it.
  const reviewStates = await readReviewStates(executor, buyerEmail, orderIds);

  return orders.flatMap((order) => {
    const intent = intentById.get(order.checkoutIntentId);

    if (intent === undefined) return [];

    const shipTo = shipToOf(intent);

    if (shipTo === null) return [];

    const arrivalDays = arrivalDaysByPackage(intent);
    const orderGroups = groups.filter((group) => group.orderId === order.id);

    const packages: BuyerPackagePayload[] = orderGroups.map(
      (group: FulfillmentGroupRow) => ({
        packageId: group.packageId,
        carrier: group.logisticName,
        trackingNumber: group.trackingNumber,
        parcelState:
          group.parcelState !== null && isParcelState(group.parcelState)
            ? group.parcelState
            : null,
        fulfillmentStatus: group.status,
        shippingAmountMinor: Number(group.shippingAmountMinor),
        arrivalDays: arrivalDays.get(group.packageId) ?? null,
        lines: lines
          .filter((line) => line.fulfillmentGroupId === group.id)
          .map((line) => ({
            id: line.id,
            title: line.title,
            variantLabel: line.variantLabel,
            quantity: line.quantity,
            unitAmountMinor: Number(line.unitAmountMinor),
            imageUrl: line.imageUrl,
            acceptedAt: line.createdAt.toISOString(),
            ...frozenListing(line.listingSnapshot),
            ...reviewStateOf(reviewStates, line.id),
          })),
        events: events
          .filter((event) => event.fulfillmentGroupId === group.id)
          .map((event) => ({
            id: event.id,
            source: event.source as BuyerTrackingEventPayload['source'],
            label: event.label,
            occurredAt: event.occurredAt.toISOString(),
            isException: event.isException,
          })),
      }),
    );

    // Lines the worker has not assigned to a group yet still belong to the
    // order; they ride in a synthetic package so no purchase is invisible.
    const orphanLines = lines.filter(
      (line) =>
        line.orderId === order.id &&
        (line.fulfillmentGroupId === null ||
          !orderGroups.some((group) => group.id === line.fulfillmentGroupId)),
    );

    if (orphanLines.length > 0) {
      packages.push({
        packageId: 'unassigned',
        carrier: 'Delivery option chosen at checkout',
        trackingNumber: null,
        parcelState: null,
        fulfillmentStatus: 'PENDING',
        shippingAmountMinor: 0,
        arrivalDays: null,
        lines: orphanLines.map((line) => ({
          id: line.id,
          title: line.title,
          variantLabel: line.variantLabel,
          quantity: line.quantity,
          unitAmountMinor: Number(line.unitAmountMinor),
          imageUrl: line.imageUrl,
          acceptedAt: line.createdAt.toISOString(),
          ...frozenListing(line.listingSnapshot),
          // An unassigned line has no package, so it has no delivered state
          // and cannot be reviewable. Spread the same helper anyway rather
          // than hardcoding `false`: one source for the answer means a later
          // change to what "reviewable" is cannot leave this branch behind.
          ...reviewStateOf(reviewStates, line.id),
        })),
        events: [],
      });
    }

    return [
      {
        orderNumber: order.orderNumber,
        placedAt: order.createdAt.toISOString(),
        paymentStatus: order.paymentStatus,
        currency: order.currency,
        amountTotalMinor: Number(order.amountMinor),
        stripeCheckoutSessionId: order.stripeCheckoutSessionId,
        packages,
        shipTo,
      },
    ];
  });
}

export async function listBuyerOrders(
  buyerEmail: string,
  options: { executor?: DbExecutor } = {},
): Promise<BuyerOrderPayload[]> {
  const executor = options.executor ?? getDb();
  const normalized = buyerEmail.trim().toLowerCase();

  if (normalized === '') return [];

  const orders = await executor
    .select()
    .from(sals3Orders)
    // `lower(...)` on both sides: the stored email is whatever the buyer
    // typed at checkout, and the session email may differ only in case.
    .where(sql`lower(${sals3Orders.buyerEmail}) = ${normalized}`)
    .orderBy(desc(sals3Orders.createdAt))
    .limit(MAX_ORDERS);

  return assembleOrders(executor, orders, normalized);
}

export async function readBuyerOrder(
  buyerEmail: string,
  orderNumber: string,
  options: { executor?: DbExecutor } = {},
): Promise<BuyerOrderPayload | null> {
  const executor = options.executor ?? getDb();
  const normalized = buyerEmail.trim().toLowerCase();

  if (normalized === '' || orderNumber.trim() === '') return null;

  const orders = await executor
    .select()
    .from(sals3Orders)
    .where(eq(sals3Orders.orderNumber, orderNumber.trim().toUpperCase()))
    .limit(1);

  const order = orders[0];

  // The email comparison happens here, after the fetch, so the two misses
  // (unknown number, someone else's number) are one code path and one timing.
  if (order === undefined || order.buyerEmail.toLowerCase() !== normalized) {
    return null;
  }

  const assembled = await assembleOrders(executor, [order], normalized);

  return assembled[0] ?? null;
}
