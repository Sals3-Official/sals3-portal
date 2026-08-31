import { revalidateTag } from 'next/cache';
import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-cache';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  REVIEW_REFUSALS,
  submitReviewInputSchema,
} from '@/modules/reviews/contracts';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../responses';

/**
 * POST /api/storefront/reviews — one buyer review of one purchased line.
 *
 * Server-to-server only, behind the same bearer token as the rest of the
 * storefront API. The buyer's identity travels in `X-Buyer-Email`, exactly as
 * the orders endpoints take it: a **header** so an address never lands in
 * access logs or a proxy cache, and never a body field the caller could confuse
 * with user input. The storefront's own server verifies the session cookie and
 * puts the verified address here — **this value is the authorisation** (rules
 * 20/21), and `resolveReviewableLine` is the only thing between it and a write.
 *
 * ## What this endpoint does not decide
 *
 * It does not decide eligibility. It validates shape, throttles, and hands a
 * verified address plus a line id to the domain. Everything about *may this
 * person review this line* lives in one `WHERE` in `eligibility.ts`, so there
 * is exactly one place to read and one place to get it wrong.
 *
 * ## Rate limited because it is a write a member of the public reaches
 *
 * Rule 29. Keyed on the buyer's address rather than the caller, because the
 * caller is always the storefront's own server — an IP key would throttle every
 * buyer as one. Best-effort and per-process, the same honest limitation
 * `lib/rate-limit.ts` documents: the real ceiling on a scaled-out host is
 * `instances x capacity`. The durable guard underneath is
 * `sals3_product_reviews_line_key`, which no amount of concurrency gets past.
 *
 * ## Photos are not posted here
 *
 * A review may carry up to four, and they arrive **one per request** at
 * `POST /reviews/[id]/photos` after this returns an id. Not folded into this
 * body: a serverless request body is capped at 4.5 MB on the deployed platform
 * and four 5 MB photos plus the multipart envelope is several times that — a
 * ceiling that rejects the request before any code here runs, so no validation
 * of ours could produce a message a buyer could act on.
 *
 * The ordering that follows from that is review-first, photos-after. It means a
 * failure partway through leaves a real review carrying fewer photos than the
 * buyer chose; the sibling route's own note explains why that beats the
 * alternatives.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_LIMIT = { capacity: 10, refillIntervalMs: 60_000 };

function refusal(reason: keyof typeof REVIEW_REFUSALS, status: number) {
  return Response.json(
    { error: REVIEW_REFUSALS[reason], reason },
    { status, headers: STOREFRONT_HEADERS },
  );
}

export async function POST(request: Request) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  const buyerEmail = request.headers.get('x-buyer-email') ?? '';

  if (buyerEmail.trim() === '' || buyerEmail.length > 254) {
    return Response.json(
      { error: 'Missing buyer identity' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  if (!isDatabaseConfigured()) {
    return refusal('not_configured', 503);
  }

  const limit = checkRateLimit(
    `storefront-review:${buyerEmail.trim().toLowerCase()}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) {
    return Response.json(
      { error: 'Too many attempts. Wait a moment and try again.' },
      { status: 429, headers: STOREFRONT_HEADERS },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return refusal('invalid_input', 400);
  }

  const parsed = submitReviewInputSchema.safeParse(payload);

  if (!parsed.success) return refusal('invalid_input', 400);

  try {
    // Imported lazily so an unreachable database cannot make this route a
    // cold-start failure, matching the internal migration routes.
    const { submitReview } = await import('@/modules/reviews/repository');
    const result = await submitReview({
      ...parsed.data,
      buyerEmail,
    });

    if (!result.ok) {
      // `not_eligible` answers 404, not 403: an unknown line, someone else's
      // line, and an undelivered line are one indistinguishable reply, and a
      // 403 would confirm the line exists. `already_reviewed` is the buyer's
      // own row, so saying so tells them nothing they did not do themselves.
      const status = result.reason === 'already_reviewed' ? 409 : 404;

      return refusal(result.reason, status);
    }

    // The rating aggregate is part of the cached product payload, so a new
    // review has to expire it or the product page keeps quoting the old
    // average for up to the cache's TTL.
    revalidateTag(STOREFRONT_CATALOG_TAG, 'max');

    return Response.json(
      { reviewId: result.reviewId },
      { status: 201, headers: STOREFRONT_HEADERS },
    );
  } catch (error) {
    return storefrontErrorResponse('POST /reviews', error);
  }
}
