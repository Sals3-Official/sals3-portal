import getDb from '@/lib/db/client';
import { cjPointsInfoSchema } from '@/lib/cj/primitives';
import { CjApiError } from '@/services/cj/config';
import { recordPointsInfo, tryAcquireRequestSlot } from './budget-repository';

/**
 * Wraps `fetch` so EVERY supplier call made through it:
 *
 * 1. passes the database-backed shared request limiter first (one request
 *    per second per connection across ALL concurrent workers - the
 *    in-process spacing inside the adapter only paces one worker); and
 * 2. persists the `pointsInfo` quota state from the real response body, so
 *    evaluation traffic keeps the points ledger observable too, not only
 *    discovery list pages.
 *
 * The slot wait is a short bounded poll (worst case a few seconds - the gap
 * between two 1-rps slots), not a sleep-until-refill: if no slot arrives
 * within the bound, the call fails as `rate-limited` and the caller's
 * park/delayed-continuation path takes over.
 */

const SLOT_POLL_INTERVAL_MS = 250;
const SLOT_WAIT_MAX_MS = 10_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForRequestSlot(connectionId: string): Promise<void> {
  const deadline = Date.now() + SLOT_WAIT_MAX_MS;

  // eslint-disable-next-line no-await-in-loop -- bounded poll against the shared limiter is the point.
  while (!(await tryAcquireRequestSlot(getDb(), connectionId))) {
    if (Date.now() >= deadline) {
      throw new CjApiError('rate-limited');
    }

    // eslint-disable-next-line no-await-in-loop -- see above.
    await delay(SLOT_POLL_INTERVAL_MS);
  }
}

export default function createGovernedFetch(
  connectionId: string,
): typeof fetch {
  return async (input, init?) => {
    await waitForRequestSlot(connectionId);

    const response = await fetch(input, init);

    // Observe pointsInfo without consuming the caller's body: read the text
    // once and hand back an equivalent Response. Persistence is best effort
    // - a ledger miss must never fail the supplier call itself.
    try {
      const text = await response.text();

      try {
        const parsed: unknown = JSON.parse(text);
        const pointsInfo = cjPointsInfoSchema.safeParse(
          (parsed as { pointsInfo?: unknown })?.pointsInfo,
        );

        if (pointsInfo.success && pointsInfo.data) {
          await recordPointsInfo(getDb(), connectionId, pointsInfo.data);
        }
      } catch {
        // Non-JSON or unexpected shape - nothing to record.
      }

      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      // Body already unusable - return the original response untouched.
      return response;
    }
  };
}
