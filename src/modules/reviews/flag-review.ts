import { and, eq } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import { isUniqueViolation } from '@/lib/db/constraint-errors';
import { productReviewFlags, productReviews } from '@/lib/db/schema/reviews';
import { type FlagRefusal, type FlagReviewInput } from './contracts';

/**
 * A buyer asking a platform moderator to look at a review.
 *
 * ## This writes a request. It does not hide anything.
 *
 * Nothing here touches `productReviews.status`, and nothing here counts reports
 * against a threshold. Hiding is `HIDDEN_BY_PLATFORM`, written only by
 * `decideOnReportedReview` behind `review:moderate`. An automatic hide at any
 * number would mean a competitor with four accounts can erase a rating, which
 * converts the review table from evidence into whatever the most motivated
 * party wants it to say — and the whole reason a buyer trusts the section is
 * that it is not that.
 *
 * ## Two guards, deliberately not one
 *
 * - The `PUBLISHED` lookup is the *authorisation*: you may only report
 *   something a buyer can actually see. A review already hidden needs no second
 *   report, and one that does not exist is not a thing to have an opinion
 *   about.
 * - `sals3_product_review_flags_reporter_key` is the *correctness*: one report
 *   per person per review, whatever two concurrent requests believe. A
 *   check-then-insert has a window between the two and this one is wide — a
 *   buyer double-tapping "Report" on a slow connection — so the unique-violation
 *   branch below is the guard, not decoration around it.
 */
export type FlagReviewResult =
  { ok: true; flagId: string } | { ok: false; reason: FlagRefusal };

export default async function flagReview(
  input: FlagReviewInput & { reporterEmail: string },
  executor: DbExecutor = getDb(),
): Promise<FlagReviewResult> {
  const reporterEmail = input.reporterEmail.trim().toLowerCase();

  if (reporterEmail === '') return { ok: false, reason: 'invalid_input' };

  const review = await executor
    .select({ id: productReviews.id })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.id, input.reviewId),
        eq(productReviews.status, 'PUBLISHED'),
      ),
    )
    .limit(1);

  // One answer over "no such review" and "already hidden", the same collapse
  // `submitReview` makes over its three ineligible cases: a distinguishable
  // reply is a way to enumerate what exists.
  if (review.length === 0) return { ok: false, reason: 'not_found' };

  try {
    const inserted = await executor
      .insert(productReviewFlags)
      .values({
        reviewId: input.reviewId,
        // Lower-cased to satisfy the column's own CHECK, and because the unique
        // index is only a one-per-person rule if the values compare equal.
        reporterEmail,
        reason: input.reason,
        // Not passed: `resolution` defaults to OPEN and `resolved_at` stays
        // null, which is the only pair `..._resolution_stamped` accepts for a
        // report nobody has decided on.
      })
      .returning({ id: productReviewFlags.id });

    const flagId = inserted[0]?.id;

    if (flagId === undefined) return { ok: false, reason: 'failed' };

    return { ok: true, flagId };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'already_reported' };
    }

    throw error;
  }
}
