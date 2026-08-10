import { handleCallback } from '@vercel/queue';
import handleQueueMessage from '@/modules/catalog/discovery/dispatcher';

/**
 * Private Vercel Queues push consumer for the `catalog-discovery` topic
 * (see vercel.json's `experimentalTriggers`). Per the verified transport
 * contract this function is air-gapped: it has no public URL and can only
 * be invoked by Vercel's queue infrastructure, so no additional bearer
 * authentication applies here - authorization happens at the control
 * routes that create work, and every handler re-validates its message and
 * re-authorizes its state transitions against the database.
 *
 * Delivery is at-least-once with implicit acknowledgment on return; a
 * thrown error triggers redelivery with backoff, and the dispatcher parks
 * poison messages as visible PostgreSQL failure records.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = handleCallback(async (message, metadata) => {
  await handleQueueMessage(message, {
    messageId: metadata.messageId,
    deliveryCount: metadata.deliveryCount,
  });
});
