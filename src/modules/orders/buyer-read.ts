import 'server-only';

import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import getDb, { type DbExecutor } from '@/lib/db/client';
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

export type BuyerOrderLinePayload = {
  id: string;
  title: string;
  variantLabel: string | null;
  quantity: number;
  unitAmountMinor: number;
  imageUrl: string | null;
  acceptedAt: string;
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

async function assembleOrders(
  executor: DbExecutor,
  orders: Sals3OrderRow[],
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
      .select()
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

  return assembleOrders(executor, orders);
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

  const assembled = await assembleOrders(executor, [order]);

  return assembled[0] ?? null;
}
