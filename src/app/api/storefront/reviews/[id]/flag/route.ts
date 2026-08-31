import isStorefrontRequestAuthorized from '@/lib/storefront/auth';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  FLAG_REFUSALS,
  flagReviewInputSchema,
  type FlagRefusal,
} from '@/modules/reviews/contracts';
import {
  storefrontErrorResponse,
  STOREFRONT_HEADERS,
  unauthorizedResponse,
} from '../../../responses';

/**
 * POST /api/storefront/reviews/[id]/flag — a buyer asking a moderator to look.
 *
 * ## This changes nothing a shopper can see
 *
 * It files a request. Hiding a review is a platform decision written elsewhere,
 * behind `review:moderate`, and no count of reports here triggers it. An
 * automatic hide at any threshold would mean a competitor with four accounts
 * can erase a rating — which turns the review section from evidence into
 * whatever the most motivated party wants it to say, and the only reason a
 * shopper reads it at all is that it is not that.
 *
 * So there is deliberately no cache revalidation in this route. Nothing it
 * writes is projected to the storefront.
 *
 * ## Signed in, and the address is the identity
 *
 * `X-Buyer-Email`, the same header the submit and order routes take: a header
 * so an address never lands in an access log or a proxy cache, and never a body
 * field the caller could confuse with user input. That address is what
 * `sals3_product_review_flags_reporter_key` counts, and it is the whole reason
 * a report costs something — an anonymous one costs nothing to make and nothing
 * to repeat, and a queue of those is a queue nobody reads.
 *
 * ## Rate limited harder than a review
 *
 * A buyer writes one review per purchased line; there is no comparable natural
 * ceiling on reporting. Five a minute is generous for a person acting in good
 * faith and useless to anyone filing in bulk — and the unique index is the
 * durable guard underneath, since the same person cannot report the same review
 * twice however fast they try.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_LIMIT = { capacity: 5, refillIntervalMs: 60_000 };

const STATUSES: Record<FlagRefusal, number> = {
  invalid_input: 400,
  not_found: 404,
  already_reported: 409,
  rate_limited: 429,
  not_configured: 503,
  failed: 500,
};

function refusal(reason: FlagRefusal) {
  return Response.json(
    { error: FLAG_REFUSALS[reason], reason },
    { status: STATUSES[reason], headers: STOREFRONT_HEADERS },
  );
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isStorefrontRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  const reporterEmail = request.headers.get('x-buyer-email') ?? '';

  if (reporterEmail.trim() === '' || reporterEmail.length > 254) {
    return Response.json(
      { error: 'Missing buyer identity' },
      { status: 400, headers: STOREFRONT_HEADERS },
    );
  }

  if (!isDatabaseConfigured()) return refusal('not_configured');

  const limit = checkRateLimit(
    `storefront-review-flag:${reporterEmail.trim().toLowerCase()}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return refusal('rate_limited');

  const { id } = await params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return refusal('invalid_input');
  }

  // The id comes from the path and the reason from the body, validated
  // together so a malformed id is the same refusal as a malformed reason —
  // and so nothing buyer-controlled reaches a `uuid` column unparsed.
  const parsed = flagReviewInputSchema.safeParse({
    reviewId: id,
    reason: (body as { reason?: unknown } | null)?.reason,
  });

  if (!parsed.success) return refusal('invalid_input');

  try {
    // Imported lazily so an unreachable database cannot make this route a
    // cold-start failure, matching every sibling here.
    const { default: flagReview } =
      await import('@/modules/reviews/flag-review');
    const result = await flagReview({ ...parsed.data, reporterEmail });

    if (!result.ok) return refusal(result.reason);

    // 202, not 201: the buyer asked for something to be looked at, and the
    // honest answer is that it has been recorded rather than acted on. A 201
    // would imply the review is now dealt with.
    return Response.json(
      { reported: true },
      { status: 202, headers: STOREFRONT_HEADERS },
    );
  } catch (error) {
    return storefrontErrorResponse(`POST /reviews/${id}/flag`, error);
  }
}
