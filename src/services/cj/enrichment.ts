import { requirePermission } from '@/lib/auth/session';
import {
  cjCommentsResponseSchema,
  cjInventoryResponseSchema,
  cjProductDetailResponseSchema,
} from '@/lib/cj/enrichment-schemas';
import toCandidateEvidence, { type CandidateEvidence } from '@/lib/cj/evidence';
import type { CjPointsInfo } from '@/lib/cj/primitives';
import { CJ_BASE_URL, CjApiError } from './config';
import { getCjAccessToken } from './token';

/**
 * Fetches fresh CJ evidence for one shortlisted candidate (spec section 8.3).
 *
 * Cost and rate discipline, both verified against the live API on 2026-08-07:
 *  - **Three calls per candidate**, ~10 points each. `/product/query` already
 *    embeds `variants`, so the separate variant call is skipped, and
 *    `getInventoryByPid` returns every variant's stock in one response rather
 *    than one call per `vid`.
 *  - Calls run **sequentially** with a delay, because CJ allows one request
 *    per second per account. Running them in parallel trips the limit.
 *  - `pointsInfo` is logged from each response so remaining quota is runtime
 *    state, not something discovered through a 429.
 *
 * This returns evidence only. It makes no decision, computes no score, and
 * grants no publish eligibility.
 */

/** CJ allows one request per second; leave headroom for clock skew. */
const REQUEST_SPACING_MS = 1_100;

const COMMENT_SAMPLE_SIZE = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logPoints(endpoint: string, points: CjPointsInfo): void {
  if (points === null || points === undefined) return;

  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      event: 'cj.points',
      endpoint,
      usedToday: points.usedToday,
      remaining: points.remaining,
    }),
  );
}

async function getJson(token: string, path: string): Promise<unknown> {
  const response = await fetch(`${CJ_BASE_URL}${path}`, {
    headers: { 'CJ-Access-Token': token },
    // Preflight evidence must be fresh; spec section 8.12 forbids reusing the
    // browse cache as proof of current variants or stock.
    cache: 'no-store',
  });

  if (response.status === 429) {
    throw new CjApiError('rate-limited');
  }

  if (!response.ok) {
    throw new CjApiError('upstream-unavailable');
  }

  return response.json();
}

async function fetchDetail(token: string, pid: string) {
  const parsed = cjProductDetailResponseSchema.safeParse(
    await getJson(token, `/product/query?pid=${encodeURIComponent(pid)}`),
  );

  if (!parsed.success) {
    throw new CjApiError('unexpected-response');
  }

  logPoints('product/query', parsed.data.pointsInfo);

  if (parsed.data.code !== 200 || !parsed.data.data) {
    throw new CjApiError(
      parsed.data.code === 401
        ? 'authentication-failed'
        : 'unexpected-response',
    );
  }

  return parsed.data.data;
}

async function fetchInventory(token: string, pid: string) {
  const parsed = cjInventoryResponseSchema.safeParse(
    await getJson(
      token,
      `/product/stock/getInventoryByPid?pid=${encodeURIComponent(pid)}`,
    ),
  );

  if (!parsed.success) {
    throw new CjApiError('unexpected-response');
  }

  logPoints('product/stock/getInventoryByPid', parsed.data.pointsInfo);

  // Inventory is evidence, not a gate here: an empty result is a real
  // observation ("no stock reported"), not a failure to fetch.
  return {
    warehouseInventories: parsed.data.data?.inventories ?? [],
    variantInventories: parsed.data.data?.variantInventories ?? [],
  };
}

async function fetchComments(token: string, pid: string) {
  const parsed = cjCommentsResponseSchema.safeParse(
    await getJson(
      token,
      `/product/productComments?pid=${encodeURIComponent(pid)}&pageNum=1&pageSize=${COMMENT_SAMPLE_SIZE}`,
    ),
  );

  if (!parsed.success) {
    throw new CjApiError('unexpected-response');
  }

  logPoints('product/productComments', parsed.data.pointsInfo);

  return {
    reviewTotal: parsed.data.data?.total ?? 0,
    comments: parsed.data.data?.list ?? [],
  };
}

export default async function fetchCandidateEvidence(
  externalProductId: string,
): Promise<CandidateEvidence> {
  await requirePermission('catalog.candidate.shortlist');

  const token = await getCjAccessToken();

  const detail = await fetchDetail(token, externalProductId);

  await delay(REQUEST_SPACING_MS);
  const inventory = await fetchInventory(token, externalProductId);

  await delay(REQUEST_SPACING_MS);
  const reviews = await fetchComments(token, externalProductId);

  return toCandidateEvidence({
    detail,
    warehouseInventories: inventory.warehouseInventories,
    variantInventories: inventory.variantInventories,
    reviewTotal: reviews.reviewTotal,
    comments: reviews.comments,
    capturedAt: new Date(),
  });
}
