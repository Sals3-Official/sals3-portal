import { z } from 'zod';

/**
 * Buyer review domain contracts.
 *
 * ## The gate is the parcel, not the order
 *
 * ADR-008 splits one checkout into per-provider fulfillment groups, and CJ has
 * no partial-shipment status, so one order can hold a delivered package beside
 * one still moving. Eligibility therefore belongs to the **line**, resolved
 * through its own group's `parcel_state`.
 *
 * `TRACKING_CONFLICT` is deliberately not eligible. ADR-004 §5 gives that state
 * to a carrier "delivered" the supplier disputes, so its buyer-facing meaning is
 * "we do not yet know this arrived" — not a reason to ask how it was.
 *
 * ## Nothing here reaches a supplier
 *
 * No value in this module originates from CJ and no code path in it calls one.
 * CJ's `listedNum` and `/product/productComments` are evidence about CJ's own
 * marketplace, never a Sals3 rating (ADR-013 §7, ADR-017).
 */

/** The one parcel state that permits a review. */
export const REVIEWABLE_PARCEL_STATE = 'DELIVERED';

/**
 * How long after delivery a buyer may still write the review.
 *
 * Measured from `coalesce(fulfillment_groups.carrier_delivered_at,
 * fulfillment_groups.updated_at)`, because there is no `parcel_state_at`
 * column: the sync stamps `parcel_state` without recording when. The fallback
 * is the sync's own last write, which can only be **later** than the real
 * delivery, so the window can only ever be generous and never unfairly short.
 * That asymmetry is the reason the fallback is acceptable at all.
 */
export const REVIEW_WINDOW_DAYS = 90;

/**
 * How long the buyer may change or withdraw their own review, measured from the
 * review's own `created_at` — exact, unlike the delivery timestamp above.
 */
export const REVIEW_EDIT_WINDOW_DAYS = 30;

/** Matches the `CHECK` constraints in `schema/reviews.ts`. */
export const REVIEW_BODY_MAX_LENGTH = 1000;
export const REVIEW_DISPLAY_NAME_MAX_LENGTH = 60;
export const REVIEW_REPLY_MAX_LENGTH = 1000;

export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

/** A rating at or below this is what the Seller Center surfaces as urgent. */
export const LOW_RATING_CEILING = 2;

/**
 * How the buyer wants to be credited — a **choice**, never a name.
 *
 * The wire deliberately carries no string. If it did, this endpoint would be a
 * way to publish any name against any purchase, and no amount of validation
 * fixes that: the value would still be caller-supplied. So `named` means
 * "credit me", and the server derives *which* name from the order's own
 * checkout ship-to, masked by `maskDisplayName`.
 *
 * The storefront shows the buyer exactly what that will render as before they
 * press, so the choice is informed — but the stored string is the server's.
 *
 * `anonymous` stores no name at all, and the storefront renders its own wording
 * for that rather than a stored "A Sals3 customer", so changing that copy never
 * becomes a data migration.
 */
export const reviewAttributionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('named') }),
  z.object({ kind: z.literal('anonymous') }),
]);

export type ReviewAttribution = z.infer<typeof reviewAttributionSchema>;

export const submitReviewInputSchema = z.object({
  orderLineId: z.string().uuid(),
  rating: z
    .number()
    .int()
    .min(1)
    .max(5)
    .transform((value) => value as ReviewRating),
  /**
   * Optional, and optional on purpose: a rating with no words is a complete
   * review. An empty string is stored as `null` rather than `''` so "wrote
   * nothing" and "wrote and cleared it" are not two states.
   */
  body: z.string().trim().max(REVIEW_BODY_MAX_LENGTH).optional(),
  /**
   * How the parcel arrived, 1-5, or absent because the buyer did not answer.
   *
   * `.optional()` and never `.default(0)`. An absent delivery score must reach
   * the column as `NULL`, because every read excludes `NULL` from the average
   * and would fold a zero straight into it — saying "the courier failed" about
   * somebody who declined to say anything. The column's own `CHECK` refuses a
   * zero for the same reason, so a default here would fail the insert rather
   * than merely lie.
   */
  deliveryRating: z
    .number()
    .int()
    .min(1)
    .max(5)
    .transform((value) => value as ReviewRating)
    .optional(),
  attribution: reviewAttributionSchema,
});

export type SubmitReviewInput = z.infer<typeof submitReviewInputSchema>;

/**
 * How many photos one review may carry.
 *
 * Bounded by `sals3_product_review_photos_position_range` as well as here — a
 * limit that only lives in a validator is a limit that stops existing the day
 * somebody writes a second writer. Four is enough to show a defect from two
 * angles plus the packaging, and small enough that the upload finishes on a
 * phone connection.
 */
export const MAX_REVIEW_PHOTOS = 4;

/** One stored review photo, as every reader sees it. */
export type ReviewPhoto = {
  url: string;
  width: number;
  height: number;
};

/**
 * Every reason a submission is refused, and the seller/buyer-facing copy for
 * it. A named reason per refusal rather than one generic failure, for the same
 * reason `publish-gates.ts` carries eleven: a caller that cannot tell "already
 * reviewed" from "not delivered" has to guess, and guesses reach buyers.
 */
export const REVIEW_REFUSALS = {
  not_eligible:
    'You can review this item once the package that carried it is delivered.',
  already_reviewed: 'You have already reviewed this item.',
  window_closed: `Reviews close ${REVIEW_WINDOW_DAYS} days after delivery.`,
  invalid_input: 'That could not be read. Check the rating and try again.',
  not_configured: 'Reviews are not available right now.',
  failed: 'The review could not be saved.',
} as const;

export type ReviewRefusal = keyof typeof REVIEW_REFUSALS;

export const replyToReviewInputSchema = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(1).max(REVIEW_REPLY_MAX_LENGTH),
  /**
   * The reply version the seller's screen rendered, or `null` when it rendered
   * no reply. Compare-and-set, not a hint: two tabs answering the same review
   * must not silently overwrite each other, and the partial unique index would
   * otherwise decide the winner by whichever transaction committed second.
   */
  expectedReplyVersion: z.number().int().positive().nullable(),
});

export type ReplyToReviewInput = z.infer<typeof replyToReviewInputSchema>;

export const REPLY_REFUSALS = {
  invalid_input: `Keep the reply under ${REVIEW_REPLY_MAX_LENGTH} characters.`,
  denied: 'Your account cannot reply to this review.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The reviews database is not available right now.',
  not_found: 'This review no longer exists, or it is not yours.',
  version_conflict:
    'This review was answered in another tab or session. Reload and try again.',
  failed: 'The reply could not be saved.',
} as const;

export type ReplyRefusal = keyof typeof REPLY_REFUSALS;

/** What the storefront renders under a product. */
export type PublicReview = {
  id: string;
  rating: ReviewRating;
  /**
   * How this buyer scored the delivery, or `null` because they did not answer.
   * A reader must render the absence as absence — never as a nought and never
   * as a default — for the same reason the column is nullable.
   */
  deliveryRating: ReviewRating | null;
  body: string | null;
  /** Already masked at write time, or `null` for an anonymous review. */
  displayName: string | null;
  /** The variant this buyer actually received, from the line's frozen snapshot. */
  variantLabel: string | null;
  /** In the order the buyer chose. Empty when they attached none. */
  photos: ReviewPhoto[];
  createdAt: string;
  reply: { body: string; createdAt: string } | null;
};

/**
 * A product's rating, computed rather than stored.
 *
 * Deliberately no rollup table in this slice. A `GROUP BY` cannot drift from
 * what is rendered, and at current volume it costs less than the invalidation
 * a denormalised counter would need — a hidden review has to decrement it, and
 * a counter that disagrees with the list beneath it is worse than a slower
 * query. Revisit when reviews clear ~50k or the feed's p95 regresses.
 */
export type RatingSummary = {
  /** Rounded to one decimal, the precision the UI shows. */
  average: number;
  count: number;
  /** Index 0 is one star. Always five entries, zeros included. */
  breakdown: [number, number, number, number, number];
  /**
   * How the deliveries were scored, over **its own denominator**.
   *
   * `null` when nobody answered the question, which is not the same fact as
   * "nobody reviewed the product" — a product can carry forty reviews and no
   * delivery score, and printing 0.0 there would be a courier's failing grade
   * invented out of silence. `count` is how many of those reviews answered, so
   * a reader can say "from 6 of 40" rather than implying all forty did.
   */
  delivery: { average: number; count: number } | null;
};

export function isLowRating(rating: number): boolean {
  return rating <= LOW_RATING_CEILING;
}

/**
 * Reporting a review.
 *
 * ## Why this is not the same shape as a review
 *
 * There is no body. The reason is a closed list, and it is closed because a
 * free-text field here would be a second unmoderated public-adjacent string
 * reachable by anyone signed in — and the moderator's actual question is
 * "which rule is this said to break", which the enum answers directly.
 *
 * ## Why there is no reporter field either
 *
 * Same posture as `submitReviewInputSchema`'s missing display name: the address
 * comes from the session on the storefront's own server and travels in
 * `X-Buyer-Email` as the authorisation itself. A body field for it would be a
 * way to file reports as somebody else, and no amount of validation fixes a
 * value the caller supplies.
 */
export const REVIEW_FLAG_REASONS = [
  'OFF_TOPIC',
  'OFFENSIVE',
  'SPAM',
  'PERSONAL_INFORMATION',
  'NOT_A_REVIEW',
] as const;

export type ReviewFlagReason = (typeof REVIEW_FLAG_REASONS)[number];

/** What each reason says to the buyer choosing it, and to the moderator reading it. */
export const REVIEW_FLAG_REASON_COPY: Record<ReviewFlagReason, string> = {
  OFF_TOPIC: 'Not about this product',
  OFFENSIVE: 'Offensive or abusive',
  SPAM: 'Spam or an advertisement',
  PERSONAL_INFORMATION: 'Contains personal information',
  NOT_A_REVIEW: 'Not a review of using the item',
};

export const flagReviewInputSchema = z.object({
  reviewId: z.string().uuid(),
  reason: z.enum(REVIEW_FLAG_REASONS),
});

export type FlagReviewInput = z.infer<typeof flagReviewInputSchema>;

export const FLAG_REFUSALS = {
  invalid_input: 'Choose a reason and try again.',
  /**
   * One answer over "no such review", "already hidden" and "not published",
   * for the same reason `not_eligible` collapses three cases on submission: a
   * distinguishable reply is a way to enumerate what exists.
   */
  not_found: 'That review is no longer available.',
  already_reported: 'You have already reported this review.',
  rate_limited: 'Too many reports. Wait a moment and try again.',
  not_configured: 'Reporting is not available right now.',
  failed: 'The report could not be sent.',
} as const;

export type FlagRefusal = keyof typeof FLAG_REFUSALS;

/**
 * What a moderator may decide.
 *
 * `hide` sets `HIDDEN_BY_PLATFORM`, which the storefront read and the aggregate
 * both already exclude. `keep` leaves the review exactly as it is and closes
 * the reports — a decision, recorded, rather than a queue item that quietly
 * ages out.
 */
export const MODERATION_DECISIONS = ['hide', 'keep'] as const;

export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

export const moderateReviewInputSchema = z.object({
  reviewId: z.string().uuid(),
  decision: z.enum(MODERATION_DECISIONS),
});

export type ModerateReviewInput = z.infer<typeof moderateReviewInputSchema>;

export const MODERATION_REFUSALS = {
  invalid_input: 'That could not be read. Reload and try again.',
  denied: 'Your account cannot moderate reviews.',
  not_configured: 'The reviews database is not available right now.',
  not_found: 'This review no longer exists.',
  failed: 'The decision could not be saved.',
} as const;

export type ModerationRefusal = keyof typeof MODERATION_REFUSALS;
