import { z } from 'zod';

/**
 * Strict queue message contracts (ADR-013 §12). Messages carry stable IDs,
 * operation type, attempt/version information, and idempotency keys ONLY -
 * never supplier payloads, tokens, credentials, or seller personal data.
 * Every handler validates its message with these schemas before touching
 * any state; an unparseable message is a visible failure, never a guess.
 */

export const QUEUE_OPERATIONS = [
  'DISCOVERY_CYCLE_START',
  'DISCOVERY_PARTITION',
  'DISCOVERY_AUDIT_UNIT',
  'DISCOVERY_CURATED_LANE',
  'EVALUATE_CANDIDATE',
  'RECONCILE_PRODUCT',
  'WEBHOOK_EVENT',
  'FULFILL_ORDER',
  'OUTBOX_DISPATCH',
] as const;

export type QueueOperation = (typeof QUEUE_OPERATIONS)[number];

const base = {
  /** Schema version for the message contract itself. */
  v: z.literal(1),
  idempotencyKey: z.string().min(1).max(500),
};

export const discoveryLaneSchema = z.enum([
  'BOOTSTRAP',
  'INCREMENTAL',
  'AUDIT',
]);

/**
 * Ensure-and-sweep for one connection's discovery chain: creates the run
 * state/cycle when absent, seeds category roots in bounded batches, and
 * re-enqueues work for unleased non-terminal partitions. Safe under
 * duplicate and out-of-order delivery - everything it does is guarded by
 * database state.
 */
export const discoveryCycleStartMessageSchema = z.object({
  ...base,
  operation: z.literal('DISCOVERY_CYCLE_START'),
  supplierConnectionId: z.uuid(),
  lane: discoveryLaneSchema.optional(),
  /** Present when this message continues a specific cycle's seeding/sweep. */
  cycleId: z.uuid().optional(),
});

export const discoveryPartitionMessageSchema = z.object({
  ...base,
  operation: z.literal('DISCOVERY_PARTITION'),
  supplierConnectionId: z.uuid(),
  cycleId: z.uuid(),
  partitionId: z.uuid(),
  /** The partition stateVersion this message expects; a stale message no-ops. */
  expectedStateVersion: z.number().int().positive().optional(),
});

export const discoveryAuditUnitMessageSchema = z.object({
  ...base,
  operation: z.literal('DISCOVERY_AUDIT_UNIT'),
  supplierConnectionId: z.uuid(),
});

export const curatedLaneSchema = z.enum([
  'CJ_TRENDING',
  'CJ_MOST_LISTED',
  'CJ_NEW_ARRIVALS',
]);

/**
 * One bounded run of a curated CJ lane. Carries only the connection and lane
 * - the resumable page cursor, window bounds, and pause reason all live in
 * `discovery_curated_lanes`, so a replayed message can never resume from a
 * stale position embedded in the message body.
 */
export const discoveryCuratedLaneMessageSchema = z.object({
  ...base,
  operation: z.literal('DISCOVERY_CURATED_LANE'),
  supplierConnectionId: z.uuid(),
  lane: curatedLaneSchema,
});

export const evaluateCandidateMessageSchema = z.object({
  ...base,
  operation: z.literal('EVALUATE_CANDIDATE'),
  candidateId: z.uuid(),
  /** Evidence/policy identity this logical evaluation job belongs to. */
  policyVersion: z.string().min(1).max(300),
  admissionReason: z.enum([
    'NEW_PRODUCT',
    'MATERIAL_SOURCE_CHANGE',
    'EVIDENCE_EXPIRED',
    'POLICY_VERSION_CHANGED',
    'RETRY_DUE',
    'CONNECTION_RESTORED',
  ]),
});

export const reconcileProductMessageSchema = z.object({
  ...base,
  operation: z.literal('RECONCILE_PRODUCT'),
  mode: z.enum(['SWEEP', 'PRODUCT']),
  /** SWEEP: which connection's due rows to requeue (bounded batch + self-chain). */
  supplierConnectionId: z.uuid().optional(),
  /** PRODUCT: the exact candidate to reconcile. */
  candidateId: z.uuid().optional(),
});

export const webhookEventMessageSchema = z.object({
  ...base,
  operation: z.literal('WEBHOOK_EVENT'),
  inboxId: z.uuid(),
  supplierConnectionId: z.uuid(),
});

export const fulfillOrderMessageSchema = z.object({
  ...base,
  operation: z.literal('FULFILL_ORDER'),
  orderId: z.uuid(),
});

export const outboxDispatchMessageSchema = z.object({
  ...base,
  operation: z.literal('OUTBOX_DISPATCH'),
});

export const queueMessageSchema = z.discriminatedUnion('operation', [
  discoveryCycleStartMessageSchema,
  discoveryPartitionMessageSchema,
  discoveryAuditUnitMessageSchema,
  discoveryCuratedLaneMessageSchema,
  evaluateCandidateMessageSchema,
  reconcileProductMessageSchema,
  webhookEventMessageSchema,
  fulfillOrderMessageSchema,
  outboxDispatchMessageSchema,
]);

export type DiscoveryCycleStartMessage = z.infer<
  typeof discoveryCycleStartMessageSchema
>;
export type DiscoveryPartitionMessage = z.infer<
  typeof discoveryPartitionMessageSchema
>;
export type DiscoveryAuditUnitMessage = z.infer<
  typeof discoveryAuditUnitMessageSchema
>;
export type DiscoveryCuratedLaneMessage = z.infer<
  typeof discoveryCuratedLaneMessageSchema
>;
export type EvaluateCandidateMessage = z.infer<
  typeof evaluateCandidateMessageSchema
>;
export type ReconcileProductMessage = z.infer<
  typeof reconcileProductMessageSchema
>;
export type WebhookEventMessage = z.infer<typeof webhookEventMessageSchema>;
export type FulfillOrderMessage = z.infer<typeof fulfillOrderMessageSchema>;
export type OutboxDispatchMessage = z.infer<typeof outboxDispatchMessageSchema>;
export type QueueMessage = z.infer<typeof queueMessageSchema>;
