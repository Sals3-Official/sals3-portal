import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import { isUniqueViolation } from '@/lib/db/constraint-errors';
import { products } from '@/lib/db/schema/product-catalog';
import { sals3OrderLines } from '@/lib/db/schema/orders';
import {
  productReviewPhotos,
  productReviewReplies,
  productReviews,
} from '@/lib/db/schema/reviews';
import {
  MAX_REVIEW_PHOTOS,
  type PublicReview,
  type RatingSummary,
  type ReviewPhoto,
  type ReviewRating,
  type ReviewRefusal,
  type SubmitReviewInput,
} from './contracts';
import maskDisplayName from './display-name';
import resolveReviewableLine from './eligibility';

/** Bounds one product's review list. Beyond this nobody reads. */
const MAX_PUBLIC_REVIEWS = 50;

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
  input: SubmitReviewInput & {
    buyerEmail: string;
    /**
     * Photos **already** processed and stored in R2 by the caller, in the order
     * the buyer chose.
     *
     * Taken as finished rows rather than as files because this function must
     * not know about object storage: the bytes are validated, re-encoded and
     * uploaded by the route before eligibility is even in question, and by the
     * time we are here the only remaining question is which review id they hang
     * off. It also keeps the failure modes apart — a rejected image is a
     * different answer to the buyer than an ineligible line.
     *
     * Trimmed to `MAX_REVIEW_PHOTOS` rather than trusted: the column's own
     * `CHECK` would refuse a fifth anyway, and refusing it here means the whole
     * review is not lost to a caller that miscounted.
     */
    photos?: {
      imageUrl: string;
      checksum: string;
      byteSize: number;
      width: number;
      height: number;
    }[];
  },
  executor: DbExecutor = getDb(),
): Promise<SubmitReviewResult> {
  const eligibility = await resolveReviewableLine(
    { buyerEmail: input.buyerEmail, orderLineId: input.orderLineId },
    executor,
  );

  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };

  const { line } = eligibility;
  const photos = (input.photos ?? []).slice(0, MAX_REVIEW_PHOTOS);

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
        // Masked here, from the order's own ship-to name — never from the
        // request. A caller-supplied string would let anyone publish any name
        // against any purchase, and an unreadable snapshot falls through to
        // anonymous rather than to a guess.
        displayName:
          input.attribution.kind === 'named' && line.buyerName !== null
            ? maskDisplayName(line.buyerName)
            : null,
        rating: input.rating,
        // `?? null`, never `?? 0`: an unanswered delivery question has to reach
        // the column as NULL, because every read excludes NULL from the average
        // and would fold a zero into it. The column's CHECK refuses a zero too,
        // so a default here would fail the insert rather than merely mislead.
        deliveryRating: input.deliveryRating ?? null,
        body: input.body === undefined || input.body === '' ? null : input.body,
        deliveredAt: line.deliveredAt,
      })
      .returning({ id: productReviews.id });

    const reviewId = inserted[0]?.id;

    if (reviewId === undefined) return { ok: false, reason: 'failed' };

    if (photos.length > 0) {
      // A second statement rather than a transaction wrapping both, and the
      // reason is the unique index above. `sals3_product_reviews_line_key` is
      // what makes a double-submitted form one review; putting both inserts in
      // a transaction here would mean this function opening one whether or not
      // its caller already has, and `DbExecutor` deliberately makes "which
      // connection is this on?" the caller's decision. A review whose photo
      // insert fails is a review with no photos — visibly incomplete to the
      // buyer, who can say so — where a swallowed transaction would be a lost
      // review with no explanation.
      await executor.insert(productReviewPhotos).values(
        photos.map((photo, position) => ({
          reviewId,
          imageUrl: photo.imageUrl,
          checksum: photo.checksum,
          byteSize: photo.byteSize,
          widthPixels: photo.width,
          heightPixels: photo.height,
          position,
        })),
      );
    }

    return { ok: true, reviewId };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'already_reviewed' };
    }

    throw error;
  }
}

/**
 * Photos for a page of reviews, keyed by review id.
 *
 * A second statement rather than a join, because a join to a one-to-many
 * multiplies the review row by its photo count and the `LIMIT` below would then
 * bound *photos* instead of reviews — a product whose newest four reviews carry
 * four pictures each would silently render sixteen rows' worth of one. One
 * extra indexed query for a whole page is not an N+1; a `LIMIT` that means
 * something different depending on the data is a bug that only shows up in
 * production.
 */
async function readPhotosFor(
  reviewIds: string[],
  executor: DbExecutor,
): Promise<Map<string, ReviewPhoto[]>> {
  if (reviewIds.length === 0) return new Map();

  const rows = await executor
    .select({
      reviewId: productReviewPhotos.reviewId,
      url: productReviewPhotos.imageUrl,
      width: productReviewPhotos.widthPixels,
      height: productReviewPhotos.heightPixels,
    })
    .from(productReviewPhotos)
    .where(inArray(productReviewPhotos.reviewId, reviewIds))
    // The buyer's own order, and the order every reader renders.
    .orderBy(
      asc(productReviewPhotos.reviewId),
      asc(productReviewPhotos.position),
    );

  const byReview = new Map<string, ReviewPhoto[]>();

  rows.forEach((row) => {
    const existing = byReview.get(row.reviewId) ?? [];

    existing.push({ url: row.url, width: row.width, height: row.height });
    byReview.set(row.reviewId, existing);
  });

  return byReview;
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
      deliveryRating: productReviews.deliveryRating,
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

  const photos = await readPhotosFor(
    rows.map((row) => row.id),
    executor,
  );

  return rows.map((row) => ({
    id: row.id,
    rating: row.rating as ReviewRating,
    deliveryRating:
      row.deliveryRating === null ? null : (row.deliveryRating as ReviewRating),
    body: row.body,
    displayName: row.displayName,
    variantLabel: row.variantLabel,
    photos: photos.get(row.id) ?? [],
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
 *
 * ## The delivery score rides the same statement, over a different denominator
 *
 * `count(delivery_rating)` rather than `count(*)`: Postgres's aggregate skips
 * NULLs, which is exactly the behaviour required. A product can carry forty
 * reviews and six delivery scores, and the delivery average must be six's
 * average — not six divided by forty, and never zero because thirty-four people
 * declined to answer. The two numbers are counted apart because they are about
 * two different parties' work, which is the whole reason the column exists.
 *
 * `sum(...)` and `count(...)` are folded per rating bucket here and reduced
 * below rather than asked for as a second `GROUP BY`, so this is still one
 * round trip for a page of cards.
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
      // NULLs skipped by both, which is the point: an unanswered delivery
      // question contributes to neither the sum nor the divisor.
      deliverySum: sql<number>`coalesce(sum(${productReviews.deliveryRating}), 0)::int`,
      deliveryCount: sql<number>`count(${productReviews.deliveryRating})::int`,
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
  const deliveries = new Map<string, { sum: number; count: number }>();

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

    const delivery = deliveries.get(row.productId) ?? { sum: 0, count: 0 };

    delivery.sum += row.deliverySum;
    delivery.count += row.deliveryCount;
    deliveries.set(row.productId, delivery);
  });

  return new Map(
    Array.from(breakdowns, ([productId, breakdown]) => {
      const count = breakdown.reduce((total, bar) => total + bar, 0);
      const weighted = breakdown.reduce(
        (total, bar, index) => total + bar * (index + 1),
        0,
      );
      const delivery = deliveries.get(productId) ?? { sum: 0, count: 0 };

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
          // `null`, not `{ average: 0, count: 0 }`. Nobody answered is a
          // different fact from everybody answered badly, and a reader handed a
          // zero has no way to tell them apart.
          delivery:
            delivery.count === 0
              ? null
              : {
                  average:
                    Math.round((delivery.sum / delivery.count) * 10) / 10,
                  count: delivery.count,
                },
        },
      ];
    }),
  );
}
