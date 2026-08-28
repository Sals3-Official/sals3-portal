import 'server-only';

import { z } from 'zod';
import createGovernedFetch from '@/modules/catalog/discovery/governed-fetch';
import type CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { CJ_BASE_URL, CjApiError } from '@/services/cj/config';

/**
 * The two CJ calls this repository makes on the order path, with the timeouts
 * that belong to each.
 *
 * Extracted from `status-sync.ts` and `fulfillment-worker.ts`, which had grown
 * near-identical copies of the same fetch-token-parse dance. One copy is now
 * the only place that decides what a CJ failure is called.
 */

/**
 * Reads answer fast or not at all: a stale status is worth less than a bounded
 * route, and the next sync run retries a group it skipped.
 */
export const CJ_READ_TIMEOUT_MS = 10_000;

/**
 * Writes get three times as long, because a write that times out is not free
 * the way a read is.
 *
 * On 2026-08-28 an order creation was abandoned at ten seconds; CJ finished it
 * thirteen seconds later and kept the order, which the portal then had no id
 * for. The buyer saw "Needs attention" for an order that genuinely existed at
 * the supplier, and every retry created a duplicate CJ rejected.
 *
 * This is the smaller half of that fix. It narrows the window; only the
 * `orderNumber` reconciliation in `fulfillment-worker.ts` closes it. Do not
 * raise this and consider the race handled — a slow enough CJ still outlives
 * any timeout worth setting on a queue route.
 */
export const CJ_WRITE_TIMEOUT_MS = 30_000;

/**
 * CJ's envelope. `message` is parsed and, unlike before, kept: it is the only
 * field that says *why* a call failed, and discarding it is what turned a
 * ten-second timeout into an investigation.
 */
export const cjEnvelopeSchema = z.object({
  code: z.number(),
  result: z.boolean().optional(),
  success: z.boolean().optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
  requestId: z.string().optional(),
});

export type CjEnvelope = z.infer<typeof cjEnvelopeSchema>;

function detailOf(envelope: { code?: number; message?: string }): {
  code?: number;
  message?: string;
} {
  return {
    ...(envelope.code === undefined ? {} : { code: envelope.code }),
    ...(envelope.message === undefined ? {} : { message: envelope.message }),
  };
}

/**
 * A CJ envelope that arrived and said no, as opposed to a request that never
 * completed. Both raise `unexpected-response`/`upstream-unavailable`; only this
 * one carries CJ's own words, which callers need to tell "no such order" from
 * "something broke".
 */
function reject(envelope: CjEnvelope): never {
  throw new CjApiError('unexpected-response', detailOf(envelope));
}

export async function getCjJson(
  connectionId: string,
  path: string,
  tokenManager: CjTokenManager,
): Promise<unknown> {
  const token = await tokenManager.getAccessToken(connectionId);
  const fetcher = createGovernedFetch(connectionId);
  let response: Response;

  try {
    response = await fetcher(`${CJ_BASE_URL}${path}`, {
      method: 'GET',
      headers: { 'CJ-Access-Token': token },
      cache: 'no-store',
      signal: AbortSignal.timeout(CJ_READ_TIMEOUT_MS),
    });
  } catch {
    throw new CjApiError('upstream-unavailable');
  }

  if (response.status === 429) throw new CjApiError('rate-limited');
  if (!response.ok) throw new CjApiError('upstream-unavailable');

  const parsed = cjEnvelopeSchema.safeParse(await response.json());

  if (!parsed.success) throw new CjApiError('unexpected-response');
  if (parsed.data.code !== 200) reject(parsed.data);

  return parsed.data.data;
}

export async function postCjJson(
  connectionId: string,
  path: string,
  body: unknown,
  tokenManager: CjTokenManager,
  options: { headers?: Record<string, string> } = {},
): Promise<CjEnvelope> {
  const token = await tokenManager.getAccessToken(connectionId);
  const fetcher = createGovernedFetch(connectionId);
  let response: Response;

  try {
    response = await fetcher(`${CJ_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'CJ-Access-Token': token,
        ...options.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(CJ_WRITE_TIMEOUT_MS),
    });
  } catch {
    throw new CjApiError('upstream-unavailable');
  }

  if (response.status === 429) throw new CjApiError('rate-limited');
  if (!response.ok) throw new CjApiError('upstream-unavailable');

  const parsed = cjEnvelopeSchema.safeParse(await response.json());

  if (!parsed.success) throw new CjApiError('unexpected-response');

  if (
    parsed.data.code !== 200 ||
    (parsed.data.result === false && parsed.data.success === false)
  ) {
    reject(parsed.data);
  }

  return parsed.data;
}
