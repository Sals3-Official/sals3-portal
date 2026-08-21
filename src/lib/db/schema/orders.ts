import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { supplierConnections } from './supplier-connections';

export const checkoutIntentStatusEnum = pgEnum('checkout_intent_status', [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
]);

export const orderPaymentStatusEnum = pgEnum('order_payment_status', [
  'PAID',
  'REFUNDED',
  'DISPUTED',
]);

export const fulfillmentGroupStatusEnum = pgEnum('fulfillment_group_status', [
  'PENDING',
  'CJ_ORDER_CREATED',
  'CJ_CART_CONFIRMED',
  'CJ_PARENT_ORDER_CREATED',
  'CJ_PAID',
  'FULFILLMENT_FAILED',
  'AWAITING_SUPPLIER_FUNDS',
]);

export const supplierOrderStepEnum = pgEnum('supplier_order_step', [
  'CREATE_ORDER_V3',
  'ADD_CART',
  'ADD_CART_CONFIRM',
  'SAVE_GENERATE_PARENT_ORDER',
  'PAY_BALANCE_V2',
]);

export const supplierOrderStepStatusEnum = pgEnum(
  'supplier_order_step_status',
  ['PENDING', 'SUCCEEDED', 'FAILED'],
);

export const checkoutIntents = pgTable(
  'checkout_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: checkoutIntentStatusEnum('status').notNull().default('PENDING'),
    buyerEmail: text('buyer_email').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    cartSnapshot: jsonb('cart_snapshot').notNull(),
    addressSnapshot: jsonb('address_snapshot').notNull(),
    freightSnapshot: jsonb('freight_snapshot').notNull(),
    shippingSelectionSnapshot: jsonb('shipping_selection_snapshot').notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeEventId: text('stripe_event_id'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('checkout_intents_stripe_session_key').on(
      table.stripeCheckoutSessionId,
    ),
    uniqueIndex('checkout_intents_stripe_event_key').on(table.stripeEventId),
    index('checkout_intents_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
    check(
      'checkout_intents_amount_non_negative',
      sql`${table.amountMinor} >= 0`,
    ),
    check(
      'checkout_intents_currency_shape',
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const sals3Orders = pgTable(
  'sals3_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: text('order_number').notNull(),
    checkoutIntentId: uuid('checkout_intent_id')
      .notNull()
      .references(() => checkoutIntents.id, { onDelete: 'restrict' }),
    stripeCheckoutSessionId: text('stripe_checkout_session_id').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    paymentStatus: orderPaymentStatusEnum('payment_status')
      .notNull()
      .default('PAID'),
    buyerEmail: text('buyer_email').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('sals3_orders_order_number_key').on(table.orderNumber),
    uniqueIndex('sals3_orders_checkout_intent_key').on(table.checkoutIntentId),
    uniqueIndex('sals3_orders_stripe_session_key').on(
      table.stripeCheckoutSessionId,
    ),
    check('sals3_orders_amount_non_negative', sql`${table.amountMinor} >= 0`),
  ],
);

export const sals3OrderLines = pgTable(
  'sals3_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => sals3Orders.id, { onDelete: 'restrict' }),
    fulfillmentGroupId: uuid('fulfillment_group_id').references(
      // eslint-disable-next-line no-use-before-define -- Drizzle resolves cross-table callbacks after module initialization.
      () => fulfillmentGroups.id,
      { onDelete: 'restrict' },
    ),
    storeLineItemId: text('store_line_item_id').notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    title: text('title').notNull(),
    quantity: integer('quantity').notNull(),
    unitAmountMinor: bigint('unit_amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    externalProductId: text('external_product_id').notNull(),
    externalVariantId: text('external_variant_id').notNull(),
    externalSku: text('external_sku'),
    sals3Sku: text('sals3_sku').notNull(),
    /**
     * The option label the buyer saw, frozen at acceptance (ADR-007). Read
     * from the provider variant reference at intent creation, never joined
     * live: a supplier renaming "Warm white / EU plug" must not rewrite what
     * an old order says was bought. Null on rows accepted before 0024.
     */
    variantLabel: text('variant_label'),
    imageUrl: text('image_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('sals3_order_lines_order_store_line_key').on(
      table.orderId,
      table.storeLineItemId,
    ),
    index('sals3_order_lines_group_idx').on(table.fulfillmentGroupId),
    check('sals3_order_lines_quantity_positive', sql`${table.quantity} > 0`),
    check(
      'sals3_order_lines_unit_amount_non_negative',
      sql`${table.unitAmountMinor} >= 0`,
    ),
  ],
);

export const fulfillmentGroups = pgTable(
  'fulfillment_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => sals3Orders.id, { onDelete: 'restrict' }),
    packageId: text('package_id').notNull(),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    originCountry: text('origin_country').notNull(),
    destinationCountry: text('destination_country').notNull(),
    logisticName: text('logistic_name').notNull(),
    optionId: text('option_id').notNull(),
    channelId: text('channel_id').notNull(),
    shippingAmountMinor: bigint('shipping_amount_minor', {
      mode: 'bigint',
    }).notNull(),
    currency: text('currency').notNull(),
    status: fulfillmentGroupStatusEnum('status').notNull().default('PENDING'),
    cjOrderId: text('cj_order_id'),
    cjShipmentOrderId: text('cj_shipment_order_id'),
    cjPayId: text('cj_pay_id'),
    lastErrorCode: text('last_error_code'),
    /**
     * ADR-004 §2 lifecycle state, written only by the status sync
     * (`modules/orders/status-sync.ts`), which is also the only place that
     * translates CJ vocabulary. Text rather than a pgEnum: the 21-state list
     * already lives in `modules/orders/contracts.ts`, and an enum would make
     * every future state a migration; the sync validates against the list
     * before writing. Null means the sync has never seen this group, and the
     * reader falls back to a mapping of `status`.
     */
    parcelState: text('parcel_state'),
    /** Carrier waybill from CJ `getOrderDetail.trackNumber`. Null until shipped. */
    trackingNumber: text('tracking_number'),
    /** CJ's own status word, kept verbatim for audit — never rendered. */
    supplierStatusRaw: text('supplier_status_raw'),
    /**
     * When the carrier's own feed said delivered. Kept separately from CJ's
     * DELIVERED so `reconcileDelivery` can hold a `TRACKING_CONFLICT` instead
     * of letting either source win (ADR-004 §5).
     */
    carrierDeliveredAt: timestamp('carrier_delivered_at', {
      withTimezone: true,
    }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('fulfillment_groups_order_package_key').on(
      table.orderId,
      table.packageId,
    ),
    index('fulfillment_groups_status_idx').on(table.status, table.createdAt),
  ],
);

export const supplierOrderSteps = pgTable(
  'supplier_order_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fulfillmentGroupId: uuid('fulfillment_group_id')
      .notNull()
      .references(() => fulfillmentGroups.id, { onDelete: 'restrict' }),
    step: supplierOrderStepEnum('step').notNull(),
    status: supplierOrderStepStatusEnum('status').notNull().default('PENDING'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestSnapshot: jsonb('request_snapshot'),
    responseSnapshot: jsonb('response_snapshot'),
    attempts: integer('attempts').notNull().default(0),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_order_steps_idempotency_key_key').on(
      table.idempotencyKey,
    ),
    uniqueIndex('supplier_order_steps_group_step_key').on(
      table.fulfillmentGroupId,
      table.step,
    ),
  ],
);

/**
 * The carrier's and the supplier's own scans, one row per event, append-only.
 *
 * Deliberately unmerged: ADR-004 §5 sets a source priority but forbids the UI
 * from resolving disagreement, so the two feeds are stored as they arrived and
 * attributed. `dedupeKey` (source + occurred_at + label, hashed by the sync)
 * makes re-syncing idempotent — CJ's trackInfo returns the full history every
 * call, and without the key every sync would duplicate every event.
 */
export const parcelTrackingEvents = pgTable(
  'parcel_tracking_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fulfillmentGroupId: uuid('fulfillment_group_id')
      .notNull()
      .references(() => fulfillmentGroups.id, { onDelete: 'restrict' }),
    source: text('source').notNull(),
    label: text('label').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    isException: boolean('is_exception').notNull().default(false),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('parcel_tracking_events_group_dedupe_key').on(
      table.fulfillmentGroupId,
      table.dedupeKey,
    ),
    index('parcel_tracking_events_group_time_idx').on(
      table.fulfillmentGroupId,
      table.occurredAt,
    ),
    check(
      'parcel_tracking_events_source_known',
      sql`${table.source} in ('CARRIER', 'SUPPLIER', 'OPERATIONS')`,
    ),
  ],
);

export type CheckoutIntentRow = typeof checkoutIntents.$inferSelect;
export type Sals3OrderRow = typeof sals3Orders.$inferSelect;
export type FulfillmentGroupRow = typeof fulfillmentGroups.$inferSelect;
export type Sals3OrderLineRow = typeof sals3OrderLines.$inferSelect;
export type ParcelTrackingEventRow = typeof parcelTrackingEvents.$inferSelect;
