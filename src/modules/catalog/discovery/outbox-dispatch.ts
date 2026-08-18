import { randomUUID } from 'crypto';
import getDb from '@/lib/db/client';
import { OUTBOX_DISPATCH_BATCH } from './config';
import { queueMessageSchema } from './messages';
import getQueueTransport from './queue-transport';
import {
  claimDispatchableOutbox,
  markOutboxDispatched,
  releaseOutboxAttempt,
} from './outbox-repository';
import { recordDiscoveryFailure } from './failure-repository';
import type { QueueOperation } from './messages';

export type DispatchOutboxOptions = {
  batchSize?: number;
  idempotencyKeys?: string[];
  operations?: QueueOperation[];
};

/**
 * Drains a bounded batch of PENDING outbox rows to the queue transport.
 * Called after every handler commit (publish-and-confirm-the-successor-
 * before-acknowledging), from the control routes, and from the break-glass
 * tick - so a crash between any commit and its publish is always repaired
 * by the next drain, whoever runs it.
 *
 * Publishing is idempotent end to end: the row's idempotency key rides to
 * the transport, which deduplicates within the message's retention window,
 * and every consumer is lease/CAS-guarded anyway.
 */
export default async function dispatchOutbox(
  options: number | DispatchOutboxOptions = {},
): Promise<{ dispatched: number; failed: number }> {
  const db = getDb();
  const leaseToken = randomUUID();
  const resolved =
    typeof options === 'number' ? { batchSize: options } : options;
  const rows = await claimDispatchableOutbox(db, {
    leaseToken,
    batchSize: resolved.batchSize ?? OUTBOX_DISPATCH_BATCH,
    idempotencyKeys: resolved.idempotencyKeys,
    operations: resolved.operations,
  });
  const transport = getQueueTransport();

  let dispatched = 0;
  let failed = 0;

  // eslint-disable-next-line no-restricted-syntax -- publish order follows creation order; a burst of parallel publishes gains nothing against a queue endpoint.
  for (const row of rows) {
    const parsed = queueMessageSchema.safeParse(row.payload);

    if (!parsed.success) {
      // A stored payload that no longer parses is a permanent, visible
      // failure - never a silent skip and never a crash loop.
      failed += 1;
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      await releaseOutboxAttempt(db, {
        id: row.id,
        leaseToken,
        attempts: Number.MAX_SAFE_INTEGER,
        errorCode: 'OUTBOX_PAYLOAD_INVALID',
      });
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      await recordDiscoveryFailure(db, {
        scope: 'OUTBOX_DISPATCH',
        referenceId: row.id,
        errorCode: 'OUTBOX_PAYLOAD_INVALID',
        attempts: row.attempts,
      });
      // eslint-disable-next-line no-continue -- guard clause per row.
      continue;
    }

    const delaySeconds =
      row.notBefore === null
        ? 0
        : Math.max(0, Math.ceil((row.notBefore.getTime() - Date.now()) / 1000));

    try {
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      await transport.publish(parsed.data, {
        idempotencyKey: row.idempotencyKey,
        delaySeconds,
      });
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      await markOutboxDispatched(db, { id: row.id, leaseToken });
      dispatched += 1;
    } catch {
      failed += 1;
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      await releaseOutboxAttempt(db, {
        id: row.id,
        leaseToken,
        attempts: row.attempts,
        errorCode: 'QUEUE_PUBLISH_FAILED',
      });
    }
  }

  return { dispatched, failed };
}
