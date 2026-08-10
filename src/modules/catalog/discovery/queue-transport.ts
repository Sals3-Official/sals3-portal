import { send } from '@vercel/queue';
import { QUEUE_TOPIC } from './config';
import type { QueueMessage } from './messages';

/**
 * Thin, swappable boundary over the durable queue transport (Vercel Queues,
 * verified `@vercel/queue@0.4.x`: at-least-once, private push consumers,
 * `delaySeconds` up to 7 days, `idempotencyKey` deduplication). Everything
 * above this boundary is transport-agnostic and unit-testable with a fake.
 *
 * Correctness NEVER depends on the transport: the PostgreSQL outbox is the
 * durable record of successor intent, and consumers are lease/CAS-guarded,
 * so a lost, duplicated, or reordered message can delay work but not corrupt
 * state or double-spend a supplier call.
 */

export interface QueueTransport {
  publish(
    message: QueueMessage,
    options: { idempotencyKey: string; delaySeconds?: number },
  ): Promise<void>;
}

/** Retention must always cover the requested delay (transport rule). */
const MAX_DELAY_SECONDS = 7 * 24 * 60 * 60;

export class VercelQueueTransport implements QueueTransport {
  // eslint-disable-next-line class-methods-use-this
  async publish(
    message: QueueMessage,
    options: { idempotencyKey: string; delaySeconds?: number },
  ): Promise<void> {
    const delaySeconds = Math.min(
      Math.max(0, Math.floor(options.delaySeconds ?? 0)),
      MAX_DELAY_SECONDS,
    );

    await send(QUEUE_TOPIC, message, {
      idempotencyKey: options.idempotencyKey,
      delaySeconds,
      // Retention must be at least the delay, or the message expires
      // undelivered; keep a day of headroom past the delay, capped at the
      // documented 7-day maximum.
      retentionSeconds: Math.min(
        MAX_DELAY_SECONDS,
        delaySeconds + 24 * 60 * 60,
      ),
    });
  }
}

let transport: QueueTransport | null = null;

export default function getQueueTransport(): QueueTransport {
  if (transport === null) {
    transport = new VercelQueueTransport();
  }

  return transport;
}

/** Test seam: swap the transport for a fake; pass null to restore the default. */
export function setQueueTransportForTesting(
  replacement: QueueTransport | null,
): void {
  transport = replacement;
}
