import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { supplierConnections } from './supplier-connections';
import { supplierEnum } from './catalog';

/**
 * Continuous full-catalogue discovery persistence (ADR-010 §12, ADR-013 §3
 * and §12). Replaces the retired page-cursor `discovery_coverage_*` tables:
 * coverage is now proven per hierarchical category/time/price partition of an
 * immutable-cutoff cycle, driven by a durable queue chain instead of a cron
 * tick, with a transactional outbox so database state and successor intent
 * can never silently diverge.
 *
 * Only legacy `GET /api2.0/v1/product/list` is used for discovery. There is
 * deliberately NO 6,000-record constant anywhere in this schema or its
 * repositories: that cap is documented for Product List V2 only, and a legacy
 * total at or beyond 6,000 is ordinary density information handled by
 * adaptive splitting, never a completion or failure threshold.
 */

// --- Operational run state ---------------------------------------------------

export const discoveryRunDesiredStateEnum = pgEnum(
  'discovery_run_desired_state',
  ['RUNNING', 'PAUSED'],
);

/**
 * One row per supplier connection: whether background discovery may perform
 * new supplier work. Pausing retains every checkpoint and queue/database
 * state; a paused handler parks its work and acknowledges instead of
 * spending supplier calls. `stateVersion` guards concurrent control calls
 * (compare-and-swap).
 */
export const discoveryRunStates = pgTable(
  'discovery_run_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    desiredState: discoveryRunDesiredStateEnum('desired_state')
      .notNull()
      .default('PAUSED'),
    stateVersion: integer('state_version').notNull().default(1),
    lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
    lastPausedAt: timestamp('last_paused_at', { withTimezone: true }),
    lastResumedAt: timestamp('last_resumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('discovery_run_states_connection_key').on(
      table.supplierConnectionId,
    ),
  ],
);

// --- Cycles ------------------------------------------------------------------

/**
 * `SEEDING`: category roots are still being created in bounded batches.
 * `RUNNING`: all roots exist; partitions are being proven.
 * `COMPLETE`: every descendant partition proved coverage. The only state
 *   that may claim full coverage of the cycle's cutoff snapshot.
 * `COVERAGE_UNRESOLVED`: every partition is terminal but at least one is
 *   `PROVIDER_COVERAGE_UNRESOLVED` - visibly incomplete, never silently
 *   promoted to `COMPLETE`.
 */
export const discoveryCycleStateEnum = pgEnum('discovery_cycle_state', [
  'SEEDING',
  'RUNNING',
  'COMPLETE',
  'COVERAGE_UNRESOLVED',
]);

export const discoveryCycles = pgTable(
  'discovery_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplier: supplierEnum('supplier').notNull().default('CJ_DROPSHIPPING'),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    /**
     * Immutable snapshot boundary: every partition in this cycle covers only
     * products created at or before this instant. Products created later are
     * intentionally the next cycle's work. Never mutated after insert.
     */
    cycleCutoff: timestamp('cycle_cutoff', { withTimezone: true }).notNull(),
    state: discoveryCycleStateEnum('state').notNull().default('SEEDING'),
    /**
     * The provider category tree observed at cycle start (leaf id/name/path
     * entries), persisted so the cycle's root set is immutable even when CJ
     * changes categories mid-cycle. Identity is the provider category id,
     * never the label.
     */
    categorySnapshot: jsonb('category_snapshot'),
    /** Bounded-seeding cursor into `categorySnapshot`; -1 once seeding is done. */
    seedCursor: integer('seed_cursor').notNull().default(0),
    partitionsTotal: integer('partitions_total').notNull().default(0),
    partitionsTerminal: integer('partitions_terminal').notNull().default(0),
    partitionsUnresolved: integer('partitions_unresolved').notNull().default(0),
    stateVersion: integer('state_version').notNull().default(1),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Queue-chain heartbeat, distinct from any HTTP health signal (ADR-010 §12.11). */
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * A new deployment or a duplicate Start call must not create two active
     * discovery chains for one connection: at most one non-terminal cycle
     * can exist per connection, enforced by the database, not application
     * politeness.
     */
    uniqueIndex('discovery_cycles_one_active_per_connection')
      .on(table.supplierConnectionId)
      .where(sql`${table.state} IN ('SEEDING', 'RUNNING')`),
    index('discovery_cycles_connection_state_idx').on(
      table.supplierConnectionId,
      table.state,
    ),
    check(
      'discovery_cycles_terminal_within_total',
      sql`${table.partitionsTerminal} <= ${table.partitionsTotal}`,
    ),
    check(
      'discovery_cycles_unresolved_within_terminal',
      sql`${table.partitionsUnresolved} <= ${table.partitionsTerminal}`,
    ),
  ],
);

// --- Partitions ----------------------------------------------------------------

/**
 * `PENDING`: awaiting its first/next probe.
 * `RECONCILING`: atomic bucket page traversal in progress (resumable).
 * `SPLIT`: superseded by persisted children - terminal for this node; its
 *   coverage obligation transferred to the children.
 * `COVERED`: coverage proven (unique valid PIDs == reported total, or
 *   total = 0).
 * `PROVIDER_COVERAGE_UNRESOLVED`: proof could not be established within
 *   bounded retries - visibly unresolved; blocks cycle COMPLETE.
 * `FAILED`: a permanent contract/validation failure exhausted its attempts -
 *   also blocks cycle COMPLETE and surfaces operationally.
 */
export const discoveryPartitionStateEnum = pgEnum('discovery_partition_state', [
  'PENDING',
  'RECONCILING',
  'SPLIT',
  'COVERED',
  'PROVIDER_COVERAGE_UNRESOLVED',
  'FAILED',
]);

export const discoveryPartitions = pgTable(
  'discovery_partitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => discoveryCycles.id, { onDelete: 'restrict' }),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    parentPartitionId: uuid('parent_partition_id'),
    /** Split ancestry depth from the category root (root = 0). */
    depth: integer('depth').notNull().default(0),
    /** Provider category id - identity, never the display label. */
    categoryId: text('category_id').notNull(),
    /**
     * Immutable filter bounds. `createTimeFromMs` NULL = open start (the
     * pre-epoch sentinel); prices in USD cents, NULL = unbounded on that
     * side. Time bounds are epoch ms so bisection is exact integer math;
     * the provider wire format is derived at request time.
     */
    createTimeFromMs: bigint('create_time_from_ms', { mode: 'number' }),
    createTimeToMs: bigint('create_time_to_ms', { mode: 'number' }).notNull(),
    priceFromCents: integer('price_from_cents'),
    priceToCents: integer('price_to_cents'),
    state: discoveryPartitionStateEnum('state').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    /** Most recent provider-reported total for this partition's filters. */
    reportedTotal: integer('reported_total'),
    /** Unique valid PIDs actually observed and ingested for this partition. */
    uniquePidCount: integer('unique_pid_count'),
    /** Sorted-unique-PID-set checksums, one entry per completed reconciliation pass. */
    passChecksums: text('pass_checksums').array().notNull().default([]),
    /** Resumable atomic-bucket traversal cursor. */
    reconcilePass: integer('reconcile_pass'),
    reconcileNextPage: integer('reconcile_next_page'),
    reconcileAttempts: integer('reconcile_attempts').notNull().default(0),
    unresolvedReason: text('unresolved_reason'),
    /** Exact lease: only the holder of (leaseToken, unexpired leasedUntil) may transition this row. */
    leaseToken: text('lease_token'),
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    stateVersion: integer('state_version').notNull().default(1),
    coveredAt: timestamp('covered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('discovery_partitions_cycle_state_idx').on(
      table.cycleId,
      table.state,
    ),
    index('discovery_partitions_connection_idx').on(table.supplierConnectionId),
    check('discovery_partitions_depth_non_negative', sql`${table.depth} >= 0`),
    check(
      'discovery_partitions_time_bounds_ordered',
      sql`${table.createTimeFromMs} IS NULL OR ${table.createTimeFromMs} < ${table.createTimeToMs}`,
    ),
    check(
      'discovery_partitions_price_bounds_ordered',
      sql`${table.priceFromCents} IS NULL OR ${table.priceToCents} IS NULL OR ${table.priceFromCents} < ${table.priceToCents}`,
    ),
  ],
);

/**
 * Atomic-bucket reconciliation PID accumulator: one row per (partition,
 * pass, PID). The primary key IS the deduplication, so a page replayed by an
 * at-least-once delivery cannot inflate the unique count. Rows are deleted
 * in the same transaction that records the partition's terminal state, so
 * the accumulator never grows past in-flight reconciliations.
 */
export const discoveryReconcilePids = pgTable(
  'discovery_reconcile_pids',
  {
    partitionId: uuid('partition_id')
      .notNull()
      .references(() => discoveryPartitions.id, { onDelete: 'cascade' }),
    pass: integer('pass').notNull(),
    pid: text('pid').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.partitionId, table.pass, table.pid] }),
  ],
);

// --- Durable work outbox -------------------------------------------------------

export const queueOperationEnum = pgEnum('queue_operation', [
  'DISCOVERY_CYCLE_START',
  'DISCOVERY_PARTITION',
  'EVALUATE_CANDIDATE',
  'RECONCILE_PRODUCT',
  'WEBHOOK_EVENT',
  'OUTBOX_DISPATCH',
]);

export const outboxStateEnum = pgEnum('outbox_state', [
  'PENDING',
  'DISPATCHED',
  'FAILED',
]);

/**
 * Transactional outbox (ADR-013 §12): a handler persists its successor
 * intent in the same transaction as its state change, then a dispatcher
 * publishes the queue message and confirms it here with compare-and-swap.
 * Database state and successor intent can therefore never silently diverge;
 * a crash between commit and publish leaves a visible PENDING row that any
 * later drain (queue handler, control route, break-glass tick) re-publishes.
 */
export const workOutbox = pgTable(
  'work_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operation: queueOperationEnum('operation').notNull(),
    /** Small message body: IDs, versions, admission reason - never supplier payloads or secrets. */
    payload: jsonb('payload').notNull(),
    /** Also sent to the queue as the transport idempotency key. */
    idempotencyKey: text('idempotency_key').notNull(),
    /** Queue delay: the message is published with `delaySeconds` derived from this. */
    notBefore: timestamp('not_before', { withTimezone: true }),
    state: outboxStateEnum('state').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    leaseToken: text('lease_token'),
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('work_outbox_idempotency_key_key').on(table.idempotencyKey),
    index('work_outbox_state_not_before_idx').on(table.state, table.notBefore),
  ],
);

// --- Failed-work / operational visibility ---------------------------------------

/**
 * Append-only operational failure records (the application-level dead-letter
 * visibility Vercel Queues does not provide). Redacted: `detail` must never
 * contain secrets, tokens, signatures, or raw supplier payloads.
 */
export const discoveryFailures = pgTable(
  'discovery_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    referenceId: text('reference_id').notNull(),
    errorCode: text('error_code').notNull(),
    detail: text('detail'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('discovery_failures_scope_idx').on(table.scope, table.createdAt),
  ],
);

// --- Shared supplier request/points budget --------------------------------------

/**
 * Database-backed shared limiter + points budget per connection, so
 * concurrent serverless workers cannot collectively exceed the configured
 * request rate or spend the priority-reserved points (ADR-013 §5).
 * `pointsTotal/pointsRemaining/pointsUsedToday` mirror the provider's own
 * `pointsInfo`, observed from real responses - never invented.
 */
export const supplierRequestBudgets = pgTable(
  'supplier_request_budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    /** Instant of the most recently granted supplier request slot. */
    lastRequestAt: timestamp('last_request_at', { withTimezone: true }),
    pointsTotal: integer('points_total'),
    pointsUsedToday: integer('points_used_today'),
    pointsRemaining: integer('points_remaining'),
    pointsObservedAt: timestamp('points_observed_at', { withTimezone: true }),
    /** Set on HTTP 429 / points exhaustion; background work waits it out via a delayed queue continuation. */
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    /** Observed provider subscription capacity for this account tier, when reported. */
    observedSubscriptionLimit: integer('observed_subscription_limit'),
    stateVersion: integer('state_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_request_budgets_connection_key').on(
      table.supplierConnectionId,
    ),
  ],
);

// --- Webhook inbox ----------------------------------------------------------------

export const webhookInboxStateEnum = pgEnum('webhook_inbox_state', [
  'PENDING',
  'PROCESSED',
  'FAILED',
]);

/**
 * Deduplicated CJ webhook event inbox. The HTTP route verifies the raw-body
 * signature, validates the decoded payload, inserts here (deduplicating on
 * messageId), persists outbox intent, and returns 200 - all heavy work
 * happens later in the WEBHOOK_EVENT queue handler. `payload` stores the
 * validated, minimal params only, never the raw body or signature.
 */
export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplier: supplierEnum('supplier').notNull().default('CJ_DROPSHIPPING'),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    messageId: text('message_id').notNull(),
    eventType: text('event_type').notNull(),
    /** INSERT | UPDATE | DELETE (or the provider's literal value, validated upstream). */
    operation: text('operation'),
    payload: jsonb('payload').notNull(),
    state: webhookInboxStateEnum('state').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('webhook_inbox_connection_message_key').on(
      table.supplierConnectionId,
      table.messageId,
    ),
    index('webhook_inbox_state_idx').on(table.state),
  ],
);

// --- Product webhook subscriptions --------------------------------------------------

export const subscriptionDesiredStateEnum = pgEnum(
  'subscription_desired_state',
  ['SUBSCRIBED', 'UNSUBSCRIBED'],
);

export const subscriptionObservedStateEnum = pgEnum(
  'subscription_observed_state',
  ['UNKNOWN', 'SUBSCRIBED', 'UNSUBSCRIBED'],
);

/**
 * CJ product-subscription desired/observed state (ADR-013 §4). Only
 * selected/imported/live/accepted-order products are ever desired -
 * never the raw candidate pool, and never `subscribeAll` (unavailable to
 * all users after July 2026).
 */
export const productSubscriptions = pgTable(
  'product_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierConnectionId: uuid('supplier_connection_id')
      .notNull()
      .references(() => supplierConnections.id, { onDelete: 'restrict' }),
    externalProductId: text('external_product_id').notNull(),
    desiredState: subscriptionDesiredStateEnum('desired_state').notNull(),
    observedState: subscriptionObservedStateEnum('observed_state')
      .notNull()
      .default('UNKNOWN'),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('product_subscriptions_connection_product_key').on(
      table.supplierConnectionId,
      table.externalProductId,
    ),
    index('product_subscriptions_desired_observed_idx').on(
      table.desiredState,
      table.observedState,
    ),
  ],
);

// --- Webhook signature secrets ---------------------------------------------------

/**
 * Encrypted CJ `openId` per connection - the documented webhook HMAC secret.
 * Same AES-256-GCM envelope shape as `supplier_connection_secrets`; only the
 * webhook verification path reads it, and it is never logged or exposed.
 */
export const supplierWebhookSecrets = pgTable('supplier_webhook_secrets', {
  connectionId: uuid('connection_id')
    .primaryKey()
    .references(() => supplierConnections.id, { onDelete: 'cascade' }),
  ciphertextBase64: text('ciphertext_base64').notNull(),
  ivBase64: text('iv_base64').notNull(),
  authTagBase64: text('auth_tag_base64').notNull(),
  keyVersion: integer('key_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type DiscoveryRunStateRow = typeof discoveryRunStates.$inferSelect;
export type DiscoveryCycleRow = typeof discoveryCycles.$inferSelect;
export type NewDiscoveryCycleRow = typeof discoveryCycles.$inferInsert;
export type DiscoveryPartitionRow = typeof discoveryPartitions.$inferSelect;
export type NewDiscoveryPartitionRow = typeof discoveryPartitions.$inferInsert;
export type WorkOutboxRow = typeof workOutbox.$inferSelect;
export type NewWorkOutboxRow = typeof workOutbox.$inferInsert;
export type DiscoveryFailureRow = typeof discoveryFailures.$inferSelect;
export type SupplierRequestBudgetRow =
  typeof supplierRequestBudgets.$inferSelect;
export type WebhookInboxRow = typeof webhookInbox.$inferSelect;
export type ProductSubscriptionRow = typeof productSubscriptions.$inferSelect;
export type SupplierWebhookSecretRow =
  typeof supplierWebhookSecrets.$inferSelect;
