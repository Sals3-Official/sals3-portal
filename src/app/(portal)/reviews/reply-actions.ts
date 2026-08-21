'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-cache';
import {
  REPLY_REFUSALS,
  replyToReviewInputSchema,
  type ReplyRefusal,
} from '@/modules/reviews/contracts';
import replyToReview, { REPLY_RATE_LIMIT } from '@/modules/reviews/reply';

/**
 * The protected boundary for a seller answering a review.
 *
 * Same discipline as `meta-description-actions.ts`: Zod-validate, authorize,
 * rate-limit, then hand a server-resolved tenant and actor to the domain.
 * `sellerAccountId` and `actorId` come only from the session — there is no
 * seller-id field on this action, so a crafted payload has nothing to aim at.
 *
 * Gated on `review:reply`, which already existed in `PORTAL_PERMISSIONS` and had
 * no caller until now. `review:moderate` is deliberately **not** used here: a
 * seller may answer a review and may not withhold one, and ADR-014 puts
 * platform moderation in the Admin Portal.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for this cookie-backed mutation.
 */
export type ReplyToReviewActionResult =
  | { ok: true; replyVersion: number }
  | { ok: false; reason: ReplyRefusal; message: string };

function refuse(reason: ReplyRefusal): ReplyToReviewActionResult {
  return { ok: false, reason, message: REPLY_REFUSALS[reason] };
}

type Authorized = { ok: true; sellerAccountId: string; actorId: string };
type AuthorizationFailure = {
  ok: false;
  reason: Extract<ReplyRefusal, 'denied' | 'rate_limited' | 'not_configured'>;
};

async function authorize(): Promise<Authorized | AuthorizationFailure> {
  if (!isDatabaseConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  let session;

  try {
    session = await requirePermission('review:reply');
  } catch (error) {
    if (error instanceof PermissionError) {
      return { ok: false, reason: 'denied' };
    }

    throw error;
  }

  // ADR-006: reviews of a Dropshipper's own listings, same scope as every
  // other product-side mutation on this account type.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(
    `review-reply:${session.sellerId}`,
    REPLY_RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export default async function replyToReviewAction(
  input: unknown,
): Promise<ReplyToReviewActionResult> {
  const parsed = replyToReviewInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await replyToReview({
    ...parsed.data,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
  });

  if (!result.ok) return refuse(result.reason);

  revalidatePath('/reviews');
  // The reply renders under the review on the product page, so the cached
  // product payload has to expire too — otherwise the seller sees their answer
  // in the portal and buyers do not, for as long as the entry stays warm.
  revalidateTag(STOREFRONT_CATALOG_TAG, 'max');

  return { ok: true, replyVersion: result.replyVersion };
}
