import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { MAX_QUEUE_DELIVERIES } from './config';
import { queueMessageSchema } from './messages';
import handleCycleStart from './handle-cycle-start';
import handlePartition from './handle-partition';
import handleEvaluateCandidate from './handle-evaluate';
import handleReconcileProduct from './handle-reconcile';
import handleWebhookEvent from './handle-webhook-event';
import dispatchOutbox from './outbox-dispatch';
import { recordDiscoveryFailure } from './failure-repository';

/**
 * Queue-consumer dispatcher. Every message:
 *
 * 1. is strictly validated (an unparseable message is a recorded, visible
 *    failure, then acknowledged - poison messages never crash-loop);
 * 2. is bounded by a delivery cap (the PG failure record IS the dead-letter
 *    visibility the transport does not provide);
 * 3. routes to its lease/CAS-guarded handler;
 * 4. drains the outbox afterward, so every successor intent the handler
 *    persisted is published-and-confirmed before this delivery acknowledges.
 *
 * Throwing (transient failure) leaves the message unacknowledged for the
 * transport's at-least-once redelivery with backoff.
 */
export default async function handleQueueMessage(
  rawMessage: unknown,
  metadata: { messageId: string; deliveryCount: number },
): Promise<void> {
  if (!isDatabaseConfigured()) {
    // No database in this environment (preview) - nothing durable can
    // happen; acknowledging avoids a redelivery storm against a deploy that
    // can never process it.
    return;
  }

  const parsed = queueMessageSchema.safeParse(rawMessage);

  if (!parsed.success) {
    await recordDiscoveryFailure(getDb(), {
      scope: 'QUEUE_CONSUMER',
      referenceId: metadata.messageId,
      errorCode: 'QUEUE_MESSAGE_INVALID',
      attempts: metadata.deliveryCount,
    });
    return;
  }

  const message = parsed.data;

  if (metadata.deliveryCount > MAX_QUEUE_DELIVERIES) {
    await recordDiscoveryFailure(getDb(), {
      scope: 'QUEUE_CONSUMER',
      referenceId: message.idempotencyKey,
      errorCode: 'QUEUE_DELIVERIES_EXHAUSTED',
      detail: `Operation ${message.operation} parked after ${metadata.deliveryCount} deliveries.`,
      attempts: metadata.deliveryCount,
    });
    return;
  }

  switch (message.operation) {
    case 'DISCOVERY_CYCLE_START':
      await handleCycleStart(message);
      break;
    case 'DISCOVERY_PARTITION':
      await handlePartition(message);
      break;
    case 'EVALUATE_CANDIDATE':
      await handleEvaluateCandidate(message);
      break;
    case 'RECONCILE_PRODUCT':
      await handleReconcileProduct(message);
      break;
    case 'WEBHOOK_EVENT':
      await handleWebhookEvent(message);
      break;
    case 'OUTBOX_DISPATCH':
      // Falls through to the drain below - the drain is the operation.
      break;
    default:
      break;
  }

  // Publish and confirm successors BEFORE acknowledging this delivery. A
  // publish failure throws, the delivery retries, and the handler's own
  // idempotency absorbs the replay.
  const { failed } = await dispatchOutbox();

  if (failed > 0) {
    throw new Error('Outbox dispatch left undispatched successors.');
  }
}
