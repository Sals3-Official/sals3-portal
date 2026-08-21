import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import { products } from '@/lib/db/schema/product-catalog';
import { sals3OrderLines } from '@/lib/db/schema/orders';
import { productReviewReplies, productReviews } from '@/lib/db/schema/reviews';
import {
  type PublicReview,
  type RatingSummary,
  type ReviewRating,
  type ReviewRefusal,
  type SubmitReviewInput,
} from './contracts';
import resolveReviewableLine from './eligibility';

/** Bounds one product's review list. Beyond this nobody reads. */
const MAX_PUBLIC_REVIEWS = 50;

/** Postgres `unique_violation`. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}

export type SubmitReviewResult =
  { ok: true; reviewId: string } | { ok: false; reason: ReviewRefusal };

/**
 * Writes one buyer review, after `resolveReviewableLine` has proved the buyer
 * may.
 *
 * Two independent guards, deliberately not one:
 *
 * - `resolveReviewableLine` is the *authorisation* — it decides whether this
 *   address owns a delivered line inside the window.
 * - `sals3_product_reviews_line_key` is the *correctness* — it decides that a
 *   line gets one review, whatever two concurrent requests believe.
 *
 * The unique-violation branch below is not defensive clutter; it is the only
 * thing standing between a double-submitted form and two reviews on one
 * purchase. A check-then-insert has a window between the two, and this one is
 * wide: a buyer tapping "Post review" twice on a slow connection.
 */
export async function submitReview(
  input: SubmitReviewInput & { buyerEmail: string },
  executor: DbExecutor = getDb(),
): Promise<SubmitReviewResult> {
  const eligibility = await resolveReviewableLine(
    { buyerEmail: input.buyerEmail, orderLineId: input.orderLineId },
    executor,
  );

  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };

  const { line } = eligibility;

  try {
    const inserted = await executor
      .insert(productReviews)
      .values({
        orderLineId: line.orderLineId,
        orderId: line.orderId,
        productId: line.productId,
        variantId: line.variantId,
        sellerAccountId: line.sellerAccountId,
        // Lower-cased to satisfy the column's own CHECK, and because every
        // lookup compares it that way.
        buyerEmail: input.buyerEmail.trim().toLowerCase(),
        displayName:
          input.attribution.kind === 'named'
            ? input.attribution.displayName
            : null,
        rating: input.rating,
        body: input.body === undefined || input.body === '' ? null : input.body,
        deliveredAt: line.deliveredAt,
      })
      .returning({ id: productReviews.id });

    const reviewId = inserted[0]?.id;

    if (reviewId === undefined) return { ok: false, reason: 'failed' };

    return { ok: true, reviewId };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'already_reviewed' };
    }

    throw error;
  }
}

/**
 * One product's published reviews, newest first, for the product page.
 *
 * Resolved by **slug**, not id, matching every other storefront read: the
 * caller has a slug because that is what the card linked to, and translating in
 * the consumer would mean a second round trip.
 *
 * `HIDDEN_BY_PLATFORM` rows are excluded here and in `readRatingSummaries`
 * below, so a moderated review leaves the list *and* stops counting toward the
 * average in the same breath. Those two filters staying in step is the whole
 * reason there is no rollup table.
 */
export async function listPublicReviewsBySlug(
  slug: string,
  executor: DbExecutor = getDb(),
): Promise<PublicReview[]> {
  const rows = await executor
    .select({
      id: productReviews.id,
      rating: productReviews.rating,
      body: productReviews.body,
      displayName: productReviews.displayName,
      variantLabel: sals3OrderLines.variantLabel,
      createdAt: productReviews.createdAt,
      replyBody: productReviewReplies.body,
      replyCreatedAt: productReviewReplies.createdAt,
    })
    .from(productReviews)
    .innerJoin(products, eq(products.id, productReviews.productId))
    .innerJoin(
      sals3OrderLines,
      eq(sals3OrderLines.id, productReviews.orderLineId),
    )
    .leftJoin(
      productReviewReplies,
      and(
        eq(productReviewReplies.reviewId, productReviews.id),
        eq(productReviewReplies.status, 'PUBLISHED'),
      ),
    )
    .where(and(eq(products.slug, slug), eq(productReviews.status, 'PUBLISHED')))
    .orderBy(desc(productReviews.createdAt))
    .limit(MAX_PUBLIC_REVIEWS);

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating as ReviewRating,
    body: row.body,
    displayName: row.displayName,
    variantLabel: row.variantLabel,
    createdAt: row.createdAt.toISOString(),
    reply:
      row.replyBody === null || row.replyCreatedAt === null
        ? null
        : { body: row.replyBody, createdAt: row.replyCreatedAt.toISOString() },
  }));
}

/**
 * Rating summaries for many products in one query, keyed by product id.
 *
 * One statement for a whole page of cards rather than one per card — the
 * N+1 rule in the code rules, and the reason this takes a list.
 */
export async function readRatingSummaries(
  productIds: string[],
  executor: DbExecutor = getDb(),
): Promise<Map<string, RatingSummary>> {
  if (productIds.length === 0) return new Map();

  const rows = await executor
    .select({
      productId: productReviews.productId,
      rating: productReviews.rating,
      total: sql<number>`count(*)::int`,
    })
    .from(productReviews)
    .where(
      and(
        inArray(productReviews.productId, productIds),
        eq(productReviews.status, 'PUBLISHED'),
      ),
    )
    .groupBy(productReviews.productId, productReviews.rating);

  const breakdowns = new Map<string, RatingSummary['breakdown']>();

  rows.forEach((row) => {
    const breakdown =
      breakdowns.get(row.productId) ??
      ([0, 0, 0, 0, 0] as RatingSummary['breakdown']);
    const index = row.rating - 1;

    // A rating outside 1-5 cannot exist — the column's CHECK forbids it — so
    // an out-of-range value here means the constraint was bypassed. Dropped
    // rather than clamped: a rating of 7 folded into the five-star bar would
    // quietly inflate an average, which is the one number this whole table
    // exists to state honestly.
    if (index >= 0 && index < 5) breakdown[index] = row.total;

    breakdowns.set(row.productId, breakdown);
  });

  return new Map(
    Array.from(breakdowns, ([productId, breakdown]) => {
      const count = breakdown.reduce((total, bar) => total + bar, 0);
      const weighted = breakdown.reduce(
        (total, bar, index) => total + bar * (index + 1),
        0,
      );

      return [
        productId,
        {
          // One decimal, the precision the UI shows. Rounded here rather than
          // in a component so every surface — card, product page, and any
          // structured data later — quotes the same number, which is the whole
          // point of having an aggregate.
          average: count === 0 ? 0 : Math.round((weighted / count) * 10) / 10,
          count,
          breakdown,
        },
      ];
    }),
  );
}
