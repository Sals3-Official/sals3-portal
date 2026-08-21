import { and, eq, inArray, sql } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import {
  fulfillmentGroups,
  sals3OrderLines,
  sals3Orders,
} from '@/lib/db/schema/orders';
import { productReviews } from '@/lib/db/schema/reviews';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';
import { REVIEW_WINDOW_DAYS, REVIEWABLE_PARCEL_STATE } from './contracts';

/**
 * Whether one buyer may review one purchased line, answered in a single
 * statement.
 *
 * ## Why it is one statement
 *
 * `resolveCandidateDetail` established the pattern this follows: the ownership
 * filter lives in the **same `WHERE`** as the lookup, so a cross-buyer id and
 * an unknown id cost exactly one query and produce the identical answer. A
 * two-step "fetch, then check" leaks through timing and through the shape of
 * the failure, and it is the version somebody eventually refactors into a
 * fetch with the check dropped.
 *
 * ## What the WHERE actually asserts
 *
 * 1. The line exists.
 * 2. Its order's `buyer_email` equals the caller's verified address, compared
 *    lower-cased exactly as `buyer-read.ts` compares it.
 * 3. The line has a fulfillment group, and that group's `parcel_state` is
 *    `DELIVERED` — the **line's own** package, because ADR-008 splits one
 *    checkout across providers and one order can hold a delivered package
 *    beside a moving one. `TRACKING_CONFLICT` fails this test on purpose
 *    (ADR-004 §5: a carrier "delivered" the supplier disputes).
 * 4. Delivery is inside the review window.
 *
 * The caller's address is authorisation, not input. It arrives from the
 * storefront's own session verification through `X-Buyer-Email`, and this
 * function is the only thing standing between that header and a write, so it
 * never widens: no "or the order is public", no admin bypass, no id-only path.
 */

/** The delivery instant, with the fallback `contracts.ts` explains. */
const deliveredAt = sql<Date>`coalesce(${fulfillmentGroups.carrierDeliveredAt}, ${fulfillmentGroups.updatedAt})`;

export type ReviewableLine = {
  orderLineId: string;
  orderId: string;
  productId: string;
  variantId: string;
  sellerAccountId: string;
  deliveredAt: Date;
};

export type EligibilityOutcome =
  | { ok: true; line: ReviewableLine }
  /**
   * Unknown line, someone else's line, a line whose package is not delivered,
   * and a line outside the window are **one** answer on purpose. A buyer who
   * can tell them apart can enumerate other people's order lines by watching
   * which id changes the reply.
   */
  | { ok: false; reason: 'not_eligible' }
  /** Distinguishable because it is the buyer's own row, and the UI must say so. */
  | { ok: false; reason: 'already_reviewed' };

/**
 * The seller of record is resolved through the line's fulfillment group and its
 * supplier connection — who actually took the order — rather than read off
 * `products.steward_seller_account_id`. The join is already required for the
 * parcel state, so it costs nothing, and it means the stored tenant records the
 * transaction rather than the current editorial owner of the listing.
 */
export default async function resolveReviewableLine(
  input: { buyerEmail: string; orderLineId: string },
  executor: DbExecutor = getDb(),
): Promise<EligibilityOutcome> {
  const normalizedEmail = input.buyerEmail.trim().toLowerCase();

  if (normalizedEmail === '') return { ok: false, reason: 'not_eligible' };

  const rows = await executor
    .select({
      orderLineId: sals3OrderLines.id,
      orderId: sals3OrderLines.orderId,
      productId: sals3OrderLines.productId,
      variantId: sals3OrderLines.variantId,
      sellerAccountId: supplierConnections.sellerAccountId,
      deliveredAt,
      existingReviewId: productReviews.id,
    })
    .from(sals3OrderLines)
    .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
    .innerJoin(
      fulfillmentGroups,
      eq(fulfillmentGroups.id, sals3OrderLines.fulfillmentGroupId),
    )
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, fulfillmentGroups.supplierConnectionId),
    )
    // Left, not inner: an existing review must not make the line vanish, or
    // "already reviewed" would be indistinguishable from "not yours".
    .leftJoin(
      productReviews,
      eq(productReviews.orderLineId, sals3OrderLines.id),
    )
    .where(
      and(
        eq(sals3OrderLines.id, input.orderLineId),
        sql`lower(${sals3Orders.buyerEmail}) = ${normalizedEmail}`,
        eq(fulfillmentGroups.parcelState, REVIEWABLE_PARCEL_STATE),
        sql`${deliveredAt} > now() - make_interval(days => ${REVIEW_WINDOW_DAYS})`,
      ),
    )
    .limit(1);

  const row = rows[0];

  if (row === undefined) return { ok: false, reason: 'not_eligible' };

  if (row.existingReviewId !== null) {
    return { ok: false, reason: 'already_reviewed' };
  }

  return {
    ok: true,
    line: {
      orderLineId: row.orderLineId,
      orderId: row.orderId,
      productId: row.productId,
      variantId: row.variantId,
      sellerAccountId: row.sellerAccountId,
      deliveredAt: row.deliveredAt,
    },
  };
}

export type LineReviewState = {
  orderLineId: string;
  /** True only when a review could be written right now. */
  reviewable: boolean;
  /** The buyer's own review of this line, when they have written one. */
  review: { id: string; rating: number; createdAt: string } | null;
};

/**
 * The same rules, evaluated for every line on one buyer's orders at once, so
 * the order pages can render the gate without a query per row.
 *
 * Deliberately a separate function rather than a loop over the one above: the
 * order page needs *all three* states (reviewable, already reviewed, not yet),
 * and a caller that only ever saw `not_eligible` could not tell "wait for
 * delivery" from "you already did this" — which is the difference between two
 * completely different things to show a buyer.
 */
export async function listLineReviewStates(
  input: { buyerEmail: string; orderIds: string[] },
  executor: DbExecutor = getDb(),
): Promise<LineReviewState[]> {
  const normalizedEmail = input.buyerEmail.trim().toLowerCase();

  if (normalizedEmail === '' || input.orderIds.length === 0) return [];

  const rows = await executor
    .select({
      orderLineId: sals3OrderLines.id,
      parcelState: fulfillmentGroups.parcelState,
      withinWindow: sql<boolean>`${deliveredAt} > now() - make_interval(days => ${REVIEW_WINDOW_DAYS})`,
      reviewId: productReviews.id,
      rating: productReviews.rating,
      reviewCreatedAt: productReviews.createdAt,
    })
    .from(sals3OrderLines)
    .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
    .leftJoin(
      fulfillmentGroups,
      eq(fulfillmentGroups.id, sals3OrderLines.fulfillmentGroupId),
    )
    .leftJoin(
      productReviews,
      eq(productReviews.orderLineId, sals3OrderLines.id),
    )
    .where(
      and(
        inArray(sals3OrderLines.orderId, input.orderIds),
        sql`lower(${sals3Orders.buyerEmail}) = ${normalizedEmail}`,
      ),
    );

  return rows.map((row) => {
    // `rating` and `created_at` are NOT NULL on the table, so a present
    // `reviewId` guarantees both. Read together rather than defaulted: a
    // fallback date here would invent a review timestamp, and an invented
    // timestamp is exactly what the edit window would then be measured from.
    const review =
      row.reviewId !== null &&
      row.rating !== null &&
      row.reviewCreatedAt !== null
        ? {
            id: row.reviewId,
            rating: row.rating,
            createdAt: row.reviewCreatedAt.toISOString(),
          }
        : null;

    return {
      orderLineId: row.orderLineId,
      reviewable:
        review === null &&
        row.parcelState === REVIEWABLE_PARCEL_STATE &&
        row.withinWindow === true,
      review,
    };
  });
}
