'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-cache';
import {
  MODERATION_REFUSALS,
  moderateReviewInputSchema,
  type ModerationRefusal,
} from '@/modules/reviews/contracts';

/**
 * The protected boundary for a platform moderator deciding on a reported
 * review.
 *
 * Same discipline as `reply-actions.ts`: Zod-validate, authorize, rate-limit,
 * then hand a server-resolved actor to the domain. There is no moderator field
 * on this action, so a crafted payload has nothing to aim at.
 *
 * ## `review:moderate`, and why that keeps a seller out
 *
 * The permission already existed in `PORTAL_PERMISSIONS` with no caller. Only
 * `admin` and `catalogue_reviewer` hold it — **no seller role does**, and
 * `permissions.test.ts` is where that stays true. That separation is the
 * substance of ADR-014: a seller who can hide criticism of their own listing
 * turns every remaining rating into a marketing claim, and the reviews section
 * is worth reading only because they cannot.
 *
 * ADR-014 names the Admin Portal as the eventual home. That repository is
 * sign-in and shell only today, so a queue placed there would be a queue nobody
 * can open — and a report button with no queue behind it is a promise the
 * platform is not keeping. The permission is what enforces the boundary; which
 * repository serves the page is a routing question this can answer later.
 *
 * ## Deliberately not scoped to a seller account
 *
 * Every other action in this folder resolves `sellerAccountId` from the session
 * and filters on it. This one does not, and must not: a platform moderator acts
 * across sellers, and scoping the decision to their own account would make the
 * queue unusable for exactly the reviews it exists to handle.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for this cookie-backed mutation.
 */
export type ModerateReviewActionResult =
  | { ok: true; decision: 'hide' | 'keep'; reportsClosed: number }
  | { ok: false; reason: ModerationRefusal; message: string };

/**
 * A decision is one click and there are only ever a handful in the queue, so
 * this is a brake on a stuck button rather than a throttle on real work.
 */
const MODERATION_RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };

function refuse(reason: ModerationRefusal): ModerateReviewActionResult {
  return { ok: false, reason, message: MODERATION_REFUSALS[reason] };
}

export default async function moderateReviewAction(
  input: unknown,
): Promise<ModerateReviewActionResult> {
  const parsed = moderateReviewInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  if (!isDatabaseConfigured()) return refuse('not_configured');

  let session;

  try {
    session = await requirePermission('review:moderate');
  } catch (error) {
    if (error instanceof PermissionError) return refuse('denied');

    throw error;
  }

  const limit = checkRateLimit(
    `review-moderate:${session.userId}`,
    MODERATION_RATE_LIMIT,
  );

  if (!limit.allowed) return refuse('invalid_input');

  const { decideOnReportedReview } =
    await import('@/modules/reviews/moderation');
  const result = await decideOnReportedReview({
    ...parsed.data,
    moderatorUserId: session.userId,
  });

  if (!result.ok) return refuse(result.reason);

  revalidatePath('/reviews/reported');

  // A hidden review leaves the product page's list *and* stops counting toward
  // its average, and both ride the cached product payload — so the entry has to
  // expire or the storefront keeps showing a review a moderator has withheld.
  // `keep` expires it too: cheap, and it means one branch cannot be the one
  // somebody forgets.
  revalidateTag(STOREFRONT_CATALOG_TAG, 'max');

  return {
    ok: true,
    decision: result.decision,
    reportsClosed: result.reportsClosed,
  };
}
