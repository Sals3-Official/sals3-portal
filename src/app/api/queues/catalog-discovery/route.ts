import { handleCallback } from '@vercel/queue';
import { revalidateTag } from 'next/cache';
import handleQueueMessage from '@/modules/catalog/discovery/dispatcher';
import { CANDIDATE_STATUS_COUNTS_TAG } from '@/modules/catalog/candidates/status-counts-cache';

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

const handleCatalogDiscoveryQueueCallback = handleCallback(
  async (message, metadata) => {
    await handleQueueMessage(message, {
      messageId: metadata.messageId,
      deliveryCount: metadata.deliveryCount,
    });

    // Every ingest, evaluate, and requeue message funnels through here, and each
    // can move a candidate between pipeline buckets - so this is where the cached
    // status counts have to be dropped, or a seller reads a stale badge.
    //
    // `'max'` is stale-while-revalidate: the next visitor is served the old count
    // while a fresh one is fetched behind them. That is the right trade for a
    // background job - the single-argument form is deprecated, and an immediate
    // blocking expiry here would make every queue message able to stall the next
    // page render.
    //
    // Deliberately unconditional. Threading a "did any count change" signal up
    // through the dispatcher would cost more complexity than one invalidation per
    // message, and the fallback for a missed drop is the cache's 30-second TTL.
    revalidateTag(CANDIDATE_STATUS_COUNTS_TAG, 'max');
  },
);

export async function POST(request: Request): Promise<Response> {
  return handleCatalogDiscoveryQueueCallback(request);
}
