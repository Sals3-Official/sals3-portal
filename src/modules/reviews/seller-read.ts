import { and, count, desc, eq, inArray, ilike, or, sql } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import {
  fulfillmentGroups,
  sals3OrderLines,
  sals3Orders,
} from '@/lib/db/schema/orders';
import { productReviewReplies, productReviews } from '@/lib/db/schema/reviews';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';
import {
  LOW_RATING_CEILING,
  type RatingSummary,
  type ReviewRating,
  REVIEWABLE_PARCEL_STATE,
} from './contracts';

/**
 * The Seller Center's read side.
 *
 * ## Tenancy is one equality, in the same WHERE as the lookup
 *
 * Every query here filters `sals3_product_reviews.seller_account_id` against a
 * session-resolved id. That column exists precisely so this is an indexed
 * equality rather than a walk from review to line to group to connection on
 * every page load — and so a cross-tenant id returns an empty page rather than
 * somebody else's reviews. `sellerAccountId` is never a request field.
 *
 * ## No number here is decorative
 *
 * The three figures the screen shows are the three a seller can act on:
 * unanswered, unanswered-and-low, and what share of delivered items got
 * reviewed at all. Deliberately **not** a "good rating rate" — that reads as a
 * score to chase, and ADR-010 keeps ratings out of anything that gates.
 */

export type SellerReviewRow = {
  id: string;
  rating: ReviewRating;
  body: string | null;
  displayName: string | null;
  createdAt: string;
  productId: string;
  productTitle: string;
  variantLabel: string | null;
  imageUrl: string | null;
  orderNumber: string;
  reply: { body: string; version: number; createdAt: string } | null;
};

export type SellerReviewFilter = {
  /** `null` means every status. */
  replyState: 'needs-reply' | 'replied' | null;
  /** Empty means every rating. */
  ratings: ReviewRating[];
  /** Trimmed; empty means no text filter. */
  query: string;
};

export const EMPTY_FILTER: SellerReviewFilter = {
  replyState: null,
  ratings: [],
  query: '',
};

/**
 * The active reply, joined on the partial-unique `PUBLISHED` row so a
 * superseded version can never render as current.
 */
const activeReply = and(
  eq(productReviewReplies.reviewId, productReviews.id),
  eq(productReviewReplies.status, 'PUBLISHED'),
);

function filterCondition(sellerAccountId: string, filter: SellerReviewFilter) {
  const clauses = [
    eq(productReviews.sellerAccountId, sellerAccountId),
    eq(productReviews.status, 'PUBLISHED'),
  ];

  if (filter.replyState === 'needs-reply') {
    clauses.push(sql`${productReviewReplies.id} is null`);
  }

  if (filter.replyState === 'replied') {
    clauses.push(sql`${productReviewReplies.id} is not null`);
  }

  if (filter.ratings.length > 0) {
    clauses.push(inArray(productReviews.rating, filter.ratings));
  }

  if (filter.query !== '') {
    // Searches the product title, the order number, and the review text -
    // the three things a seller actually has in hand when they come looking.
    // `ilike` with wrapped wildcards rather than a tsvector: the volume is
    // small, and a full-text index would be a migration for a screen that
    // does not have one yet.
    const pattern = `%${filter.query}%`;
    const textMatch = or(
      ilike(sals3OrderLines.title, pattern),
      ilike(sals3Orders.orderNumber, pattern),
      ilike(productReviews.body, pattern),
    );

    if (textMatch !== undefined) clauses.push(textMatch);
  }

  return and(...clauses);
}

function baseQuery(executor: DbExecutor) {
  return executor
    .select({
      id: productReviews.id,
      rating: productReviews.rating,
      body: productReviews.body,
      displayName: productReviews.displayName,
      createdAt: productReviews.createdAt,
      productId: productReviews.productId,
      productTitle: sals3OrderLines.title,
      variantLabel: sals3OrderLines.variantLabel,
      imageUrl: sals3OrderLines.imageUrl,
      orderNumber: sals3Orders.orderNumber,
      replyBody: productReviewReplies.body,
      replyVersion: productReviewReplies.replyVersion,
      replyCreatedAt: productReviewReplies.createdAt,
    })
    .from(productReviews)
    .innerJoin(
      sals3OrderLines,
      eq(sals3OrderLines.id, productReviews.orderLineId),
    )
    .innerJoin(sals3Orders, eq(sals3Orders.id, productReviews.orderId))
    .leftJoin(productReviewReplies, activeReply);
}

export type SellerReviewPage = { rows: SellerReviewRow[]; total: number };

/**
 * The product title, variant and image come from the **order line**, not the
 * live listing. A seller who renamed or re-photographed the product still sees
 * the review against what the buyer actually received (ADR-007), which is also
 * the only version of it their reply can sensibly answer.
 */
export async function listSellerReviews(
  input: {
    sellerAccountId: string;
    filter: SellerReviewFilter;
    page: number;
    limit: number;
  },
  executor: DbExecutor = getDb(),
): Promise<SellerReviewPage> {
  const condition = filterCondition(input.sellerAccountId, input.filter);

  const [rows, totals] = await Promise.all([
    baseQuery(executor)
      .where(condition)
      .orderBy(desc(productReviews.createdAt))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    executor
      .select({ total: count() })
      .from(productReviews)
      .innerJoin(
        sals3OrderLines,
        eq(sals3OrderLines.id, productReviews.orderLineId),
      )
      .innerJoin(sals3Orders, eq(sals3Orders.id, productReviews.orderId))
      .leftJoin(productReviewReplies, activeReply)
      .where(condition),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      rating: row.rating as ReviewRating,
      body: row.body,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
      productId: row.productId,
      productTitle: row.productTitle,
      variantLabel: row.variantLabel,
      imageUrl: row.imageUrl,
      orderNumber: row.orderNumber,
      reply:
        row.replyBody === null ||
        row.replyVersion === null ||
        row.replyCreatedAt === null
          ? null
          : {
              body: row.replyBody,
              version: row.replyVersion,
              createdAt: row.replyCreatedAt.toISOString(),
            },
    })),
    total: totals[0]?.total ?? 0,
  };
}

export type SellerReviewSummary = RatingSummary & {
  needsReply: number;
  lowUnanswered: number;
  /** Delivered lines this seller shipped, whether reviewed or not. */
  deliveredLines: number;
};

export async function readSellerReviewSummary(
  sellerAccountId: string,
  executor: DbExecutor = getDb(),
): Promise<SellerReviewSummary> {
  const [buckets, unanswered, delivered] = await Promise.all([
    executor
      .select({
        rating: productReviews.rating,
        total: sql<number>`count(*)::int`,
      })
      .from(productReviews)
      .where(
        and(
          eq(productReviews.sellerAccountId, sellerAccountId),
          eq(productReviews.status, 'PUBLISHED'),
        ),
      )
      .groupBy(productReviews.rating),
    executor
      .select({
        rating: productReviews.rating,
        total: sql<number>`count(*)::int`,
      })
      .from(productReviews)
      .leftJoin(productReviewReplies, activeReply)
      .where(
        and(
          eq(productReviews.sellerAccountId, sellerAccountId),
          eq(productReviews.status, 'PUBLISHED'),
          sql`${productReviewReplies.id} is null`,
        ),
      )
      .groupBy(productReviews.rating),
    // The denominator for "how many delivered items got reviewed". Counted
    // from the parcels rather than from the reviews, because the interesting
    // number is the gap between the two.
    executor
      .select({ total: count() })
      .from(sals3OrderLines)
      .innerJoin(
        fulfillmentGroups,
        eq(fulfillmentGroups.id, sals3OrderLines.fulfillmentGroupId),
      )
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, fulfillmentGroups.supplierConnectionId),
      )
      .where(
        and(
          eq(supplierConnections.sellerAccountId, sellerAccountId),
          eq(fulfillmentGroups.parcelState, REVIEWABLE_PARCEL_STATE),
        ),
      ),
  ]);

  const breakdown = [0, 0, 0, 0, 0] as RatingSummary['breakdown'];

  buckets.forEach((bucket) => {
    const index = bucket.rating - 1;

    if (index >= 0 && index < 5) breakdown[index] = bucket.total;
  });

  const reviewCount = breakdown.reduce((total, bar) => total + bar, 0);
  const weighted = breakdown.reduce(
    (total, bar, index) => total + bar * (index + 1),
    0,
  );

  return {
    average:
      reviewCount === 0 ? 0 : Math.round((weighted / reviewCount) * 10) / 10,
    count: reviewCount,
    breakdown,
    needsReply: unanswered.reduce((total, bucket) => total + bucket.total, 0),
    lowUnanswered: unanswered
      .filter((bucket) => bucket.rating <= LOW_RATING_CEILING)
      .reduce((total, bucket) => total + bucket.total, 0),
    deliveredLines: delivered[0]?.total ?? 0,
  };
}
