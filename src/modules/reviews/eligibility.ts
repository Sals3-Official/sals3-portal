import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import getDb, { type DbExecutor } from '@/lib/db/client';
import {
  checkoutIntents,
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

/**
 * A driver value for `coalesce(carrier_delivered_at, updated_at)`, as a `Date`.
 *
 * ## Why this exists — `sql<Date>` was a lie, and it took production down
 *
 * The first version of this file wrote `sql<Date>\`coalesce(…)\`` and passed the
 * result straight into `product_reviews.delivered_at`. A raw `sql` template
 * carries **`noopDecoder`** (`drizzle-orm/sql/sql.cjs`), so the `<Date>` is a
 * compile-time assertion and nothing at runtime honours it — whatever the driver
 * hands back is what the writer receives.
 *
 * When a `string` arrived, `PgTimestamp.mapToDriverValue` did
 * `value.toISOString()` and threw `TypeError: value.toISOString is not a
 * function`. That surfaced as `storefrontErrorResponse` → `503`, which the
 * storefront maps to its catch-all sentence: *"Your review could not be posted.
 * Try again in a moment."* — advice that could never come true, on the first
 * review anybody tried to write.
 *
 * ## Why the column's own decoder, then an assertion
 *
 * `mapFromDriverValue` is where drizzle already knows how to read this exact
 * column, so the parsing rule stays in one place instead of being re-derived
 * here. But it returns anything that is not a `string` unchanged, which is how a
 * non-`Date` reached an insert in the first place — so the result is checked. A
 * named failure at the boundary beats the same `TypeError` three frames deep
 * inside query building, and a rejected value beats a guessed one: this instant
 * anchors the review edit window, so inventing a conversion for a shape we do
 * not understand would silently move a buyer's deadline.
 *
 * `listLineReviewStates` never needed this — it compares the expression inside
 * SQL and reads back a boolean — which is exactly why the read path kept working
 * and drew a button the write path could not honour.
 *
 * ## `null` never arrives here
 *
 * Drizzle short-circuits a `null` driver value before any decoder runs
 * (`drizzle-orm/utils.cjs`), so this would never see one — and it cannot happen
 * anyway, because `fulfillment_groups.updated_at` is `NOT NULL DEFAULT now()`
 * and is the `coalesce` fallback. Making that column nullable would put a `null`
 * into a `Date` field without this function being consulted, which is the one
 * change that would defeat it.
 *
 * ## Exported so it can be tested at all
 *
 * `eligibility.test.ts` drives a hand-built fake whose `then` resolves the canned
 * rows directly, so drizzle's result mapping — and therefore this decoder —
 * never runs there. That fake is right for what it was built for (it renders the
 * real `WHERE` and asserts the predicate carries every condition), and it is
 * also why `verify` was green in both repositories while this defect shipped. A
 * behavioural test through the fake would pass no matter what this function did,
 * so the function is named, exported, and tested directly.
 */
export function asDeliveredAt(value: unknown): Date {
  const mapped = fulfillmentGroups.updatedAt.mapFromDriverValue(
    value as string,
  );

  if (mapped instanceof Date && !Number.isNaN(mapped.getTime())) {
    return mapped;
  }

  throw new TypeError(
    `coalesce(carrier_delivered_at, updated_at) is not a timestamp: ${typeof value}`,
  );
}

/**
 * The delivery instant, with the fallback `contracts.ts` explains.
 *
 * The type comes from the decoder rather than from an annotation, so it is
 * earned instead of asserted.
 */
const deliveredAt =
  sql`coalesce(${fulfillmentGroups.carrierDeliveredAt}, ${fulfillmentGroups.updatedAt})`.mapWith(
    asDeliveredAt,
  );

/**
 * The ship-to `fullName` from a checkout snapshot, or `null`.
 *
 * Parsed narrowly rather than through the full address schema: this needs one
 * field, and a snapshot whose postcode has drifted must not cost the buyer their
 * name. Bounded because it becomes a published string.
 */
const shipToNameSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
});

function shipToNameOf(snapshot: unknown): string | null {
  const parsed = shipToNameSchema.safeParse(snapshot);

  return parsed.success ? parsed.data.fullName : null;
}

export type ReviewableLine = {
  orderLineId: string;
  orderId: string;
  productId: string;
  variantId: string;
  sellerAccountId: string;
  deliveredAt: Date;
  /**
   * The ship-to name the buyer entered at checkout, raw and unmasked.
   *
   * The source for a `named` review's display string, so the stored name comes
   * from the order rather than from the request. `null` when the snapshot cannot
   * be read, which the writer must treat as the anonymous case — never as a
   * reason to fall back to something else.
   */
  buyerName: string | null;
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
      addressSnapshot: checkoutIntents.addressSnapshot,
      existingReviewId: productReviews.id,
    })
    .from(sals3OrderLines)
    .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
    // The order's own checkout snapshot, for the ship-to name. Inner because
    // `checkout_intent_id` is NOT NULL on every order.
    .innerJoin(
      checkoutIntents,
      eq(checkoutIntents.id, sals3Orders.checkoutIntentId),
    )
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
      buyerName: shipToNameOf(row.addressSnapshot),
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
