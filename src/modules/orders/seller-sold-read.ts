import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import {
  fulfillmentGroups,
  sals3OrderLines,
  sals3Orders,
} from '@/lib/db/schema/orders';
import { products } from '@/lib/db/schema/product-catalog';
import { productReviews } from '@/lib/db/schema/reviews';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';
import { REVIEWABLE_PARCEL_STATE } from '@/modules/reviews/contracts';

/**
 * How many of each thing the seller has actually sold.
 *
 * ## "Sold" means the parcel arrived (owner decision, 2026-08-30)
 *
 * A unit counts once **both** halves are true: the payment cleared *and* the
 * parcel reached `DELIVERED`. Money that arrived is not a sale while the goods
 * are still in the air — a parcel can still be lost, refused or cancelled, and
 * counting it early means counting something that may never happen.
 *
 * This is the conservative reading and it costs something real: CJ transit runs
 * two to four weeks, so the figure lags by about that much and sits far below
 * the count of paid orders. `inTransitUnits` exists so that gap is visible
 * rather than mysterious — a seller who watched a paid order never appear here
 * would otherwise reasonably conclude the page was broken.
 *
 * ## Why this needs no new column and no supplier call
 *
 * Every fact is already on rows this database holds. `sals3_order_lines` freezes
 * `product_id`, `quantity` and `unit_amount_minor` at acceptance (ADR-007),
 * `sals3_orders.payment_status` says whether the money stood, and
 * `fulfillment_groups.parcel_state` says whether it landed. No DDL, no
 * denormalised counter to drift, and no CJ request — which the operating
 * contract's §9 call budget requires checking before any new read.
 *
 * ## The parcel join is now required, and that flips an old hazard
 *
 * `fulfillment_groups` is reached through
 * `sals3_order_lines.fulfillment_group_id`, which is **nullable**. An earlier
 * version of this module avoided that join for exactly that reason: it would
 * silently drop lines not yet grouped into a parcel and understate sales. Under
 * the delivered rule the same behaviour is now *correct* — a line with no parcel
 * has definitionally not arrived, so dropping it is the answer rather than the
 * bug.
 *
 * Tenancy still goes through `sals3_order_lines.supplier_connection_id`, which
 * is `NOT NULL`, so scope never depends on a parcel existing.
 *
 * ## Reviews are counted separately, on purpose
 *
 * Joining `sals3_product_reviews` into the aggregate below would fan each order
 * line out into one row per review and multiply every quantity by it. The review
 * tallies are their own query, merged by product id in JavaScript.
 */

/** Mirrors `orderPaymentStatusEnum`. Kept as a union so `inArray` stays typed. */
type OrderPaymentStatus = 'PAID' | 'REFUNDED' | 'DISPUTED';

/** The payment half of a sale. */
const SOLD_PAYMENT_STATE: OrderPaymentStatus = 'PAID';

/** Payment states that reverse one. */
const REVERSED_PAYMENT_STATES: readonly OrderPaymentStatus[] = [
  'REFUNDED',
  'DISPUTED',
];

export type SellerSoldRow = {
  productId: string;
  /** The catalogue's current title, falling back to what the order froze. */
  title: string;
  /** Frozen at acceptance, so it always resolves without a media join. */
  imageUrl: string | null;
  currency: string;
  /** Units delivered and paid for. */
  units: number;
  /** Distinct orders carrying this product, not line count. */
  orders: number;
  revenueMinor: number;
  /** Published reviews for this product. Zero is a real, common answer. */
  reviewCount: number;
  /** Mean of published ratings, or `null` when there are none. */
  averageRating: number | null;
};

export type SellerSoldSummary = {
  totalUnits: number;
  /** Distinct orders across every product — always at or below the sum of the
      per-product `orders`, because one order can carry several products. */
  distinctOrders: number;
  productCount: number;
  /** One entry per currency actually sold in. Normally length 0 or 1. */
  revenueByCurrency: Array<{ currency: string; revenueMinor: number }>;
  /** Units on refunded or disputed orders, excluded from every figure above. */
  refundedUnits: number;
  /**
   * Paid units whose parcel has not arrived, excluded from everything above.
   *
   * Reported because the delivered rule makes them invisible otherwise, and a
   * seller who remembers taking the order needs to see where it went.
   */
  inTransitUnits: number;
};

/**
 * The window a figure covers. `to` is exclusive; the caller has already pushed
 * an inclusive end-date to the following midnight.
 */
export type SoldDateRange = { from: Date | null; to: Date | null };

export const WHOLE_HISTORY: SoldDateRange = { from: null, to: null };

/**
 * Postgres returns `bigint` as a string through this driver, and `sum()` of an
 * integer column comes back as `numeric`. Both arrive as strings, so every
 * aggregate is coerced here rather than trusted to be a number.
 */
function toCount(value: unknown): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Filtered on `sals3_orders.created_at` — when the order was accepted, which is
 * when the money cleared. Deliberately not the delivery timestamp, even now that
 * delivery gates the count: a sale belongs to the month it was made, or a seller
 * reconciling August would find August changing as parcels landed in September.
 *
 * Plain `gte`/`lt` operators rather than a `sql` template: a value interpolated
 * into a template has no column context, skips `mapToDriverValue`, and reaches
 * the driver as a raw `Date` the query then rejects.
 */
function windowClause(range: SoldDateRange) {
  return and(
    range.from === null ? undefined : gte(sals3Orders.createdAt, range.from),
    range.to === null ? undefined : lt(sals3Orders.createdAt, range.to),
  );
}

function sellerScope(
  sellerAccountId: string,
  paymentStates: readonly OrderPaymentStatus[],
  range: SoldDateRange,
) {
  return and(
    eq(supplierConnections.sellerAccountId, sellerAccountId),
    inArray(sals3Orders.paymentStatus, [...paymentStates]),
    windowClause(range),
  );
}

/** Paid **and** arrived. The definition of a sale on this surface. */
function deliveredScope(sellerAccountId: string, range: SoldDateRange) {
  return and(
    sellerScope(sellerAccountId, [SOLD_PAYMENT_STATE], range),
    eq(fulfillmentGroups.parcelState, REVIEWABLE_PARCEL_STATE),
  );
}

/** Per-product sales, best first. Reviews are merged in, never joined. */
export async function readSellerSoldRows(
  sellerAccountId: string,
  range: SoldDateRange = WHOLE_HISTORY,
  executor: DbExecutor = getDb(),
): Promise<SellerSoldRow[]> {
  const [sales, reviewTallies] = await Promise.all([
    executor
      .select({
        productId: sals3OrderLines.productId,
        currency: sals3OrderLines.currency,
        // Grouped rather than aggregated: `products.title` is constant per
        // `products.id`, which is the join key.
        currentTitle: products.title,
        // The frozen title can differ between orders if the seller renamed the
        // product, so one has to be chosen. It is only a fallback for a product
        // row that no longer exists, where any frozen title is equally true.
        frozenTitle: sql<string>`max(${sals3OrderLines.title})`,
        imageUrl: sql<string | null>`max(${sals3OrderLines.imageUrl})`,
        units: sql<string>`sum(${sals3OrderLines.quantity})`,
        orders: sql<string>`count(distinct ${sals3OrderLines.orderId})`,
        revenueMinor: sql<string>`sum(${sals3OrderLines.quantity} * ${sals3OrderLines.unitAmountMinor})`,
      })
      .from(sals3OrderLines)
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, sals3OrderLines.supplierConnectionId),
      )
      .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
      .innerJoin(
        fulfillmentGroups,
        eq(fulfillmentGroups.id, sals3OrderLines.fulfillmentGroupId),
      )
      .leftJoin(products, eq(products.id, sals3OrderLines.productId))
      .where(deliveredScope(sellerAccountId, range))
      .groupBy(
        sals3OrderLines.productId,
        sals3OrderLines.currency,
        products.title,
      ),

    executor
      .select({
        productId: productReviews.productId,
        reviewCount: sql<string>`count(*)`,
        ratingSum: sql<string>`sum(${productReviews.rating})`,
      })
      .from(productReviews)
      .where(
        and(
          eq(productReviews.sellerAccountId, sellerAccountId),
          eq(productReviews.status, 'PUBLISHED'),
        ),
      )
      .groupBy(productReviews.productId),
  ]);

  const tallyByProduct = new Map(
    reviewTallies.map((row) => [
      row.productId,
      {
        count: toCount(row.reviewCount),
        sum: toCount(row.ratingSum),
      },
    ]),
  );

  return sales
    .map((row) => {
      const tally = tallyByProduct.get(row.productId);
      const reviewCount = tally?.count ?? 0;

      return {
        productId: row.productId,
        title: row.currentTitle ?? row.frozenTitle,
        imageUrl: row.imageUrl,
        currency: row.currency,
        units: toCount(row.units),
        orders: toCount(row.orders),
        revenueMinor: toCount(row.revenueMinor),
        reviewCount,
        averageRating:
          reviewCount === 0
            ? null
            : Math.round((tally!.sum / reviewCount) * 10) / 10,
      };
    })
    .sort((left, right) => {
      if (right.units !== left.units) return right.units - left.units;

      return left.title.localeCompare(right.title);
    });
}

/**
 * Account-wide totals.
 *
 * Counted from the lines rather than folded up from `readSellerSoldRows`,
 * because `distinctOrders` cannot be derived by adding per-product order counts
 * — one order carrying three products would be counted three times, which is
 * exactly the mistake that makes a headline figure quietly wrong.
 */
export async function readSellerSoldSummary(
  sellerAccountId: string,
  range: SoldDateRange = WHOLE_HISTORY,
  executor: DbExecutor = getDb(),
): Promise<SellerSoldSummary> {
  const counts = () =>
    executor
      .select({
        units: sql<string>`coalesce(sum(${sals3OrderLines.quantity}), 0)`,
        orders: sql<string>`count(distinct ${sals3OrderLines.orderId})`,
        productCount: sql<string>`count(distinct ${sals3OrderLines.productId})`,
      })
      .from(sals3OrderLines)
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, sals3OrderLines.supplierConnectionId),
      )
      .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId));

  const [totals, revenue, reversed, paidAll] = await Promise.all([
    counts()
      .innerJoin(
        fulfillmentGroups,
        eq(fulfillmentGroups.id, sals3OrderLines.fulfillmentGroupId),
      )
      .where(deliveredScope(sellerAccountId, range)),

    executor
      .select({
        currency: sals3OrderLines.currency,
        revenueMinor: sql<string>`sum(${sals3OrderLines.quantity} * ${sals3OrderLines.unitAmountMinor})`,
      })
      .from(sals3OrderLines)
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, sals3OrderLines.supplierConnectionId),
      )
      .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
      .innerJoin(
        fulfillmentGroups,
        eq(fulfillmentGroups.id, sals3OrderLines.fulfillmentGroupId),
      )
      .where(deliveredScope(sellerAccountId, range))
      .groupBy(sals3OrderLines.currency),

    counts().where(
      sellerScope(sellerAccountId, REVERSED_PAYMENT_STATES, range),
    ),

    // Everything paid, delivered or not. The difference against `totals` is what
    // is still moving, and reporting it is what stops a paid order looking as
    // though it vanished.
    counts().where(sellerScope(sellerAccountId, [SOLD_PAYMENT_STATE], range)),
  ]);

  const deliveredUnits = toCount(totals[0]?.units);
  const paidUnits = toCount(paidAll[0]?.units);

  return {
    totalUnits: deliveredUnits,
    distinctOrders: toCount(totals[0]?.orders),
    productCount: toCount(totals[0]?.productCount),
    revenueByCurrency: revenue
      .map((row) => ({
        currency: row.currency,
        revenueMinor: toCount(row.revenueMinor),
      }))
      .sort((left, right) => right.revenueMinor - left.revenueMinor),
    refundedUnits: toCount(reversed[0]?.units),
    // Clamped: the two figures come from separate statements, so a delivery
    // landing between them could otherwise produce a negative.
    inTransitUnits: Math.max(paidUnits - deliveredUnits, 0),
  };
}

/**
 * Units sold per product for a set of product ids, for the storefront card.
 *
 * Same delivered rule as the seller's own view — a shopper reading "12 sold"
 * should be reading how many people received one, not how many paid.
 *
 * Deliberately separate from `readSellerSoldRows`: that one carries revenue,
 * which must never cross into a buyer-facing payload. This returns counts only,
 * and is not seller-scoped — a shopper's card shows how many of that product
 * sold, whoever the steward is.
 */
export async function readSoldUnitsForProducts(
  productIds: string[],
  executor: DbExecutor = getDb(),
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();

  const rows = await executor
    .select({
      productId: sals3OrderLines.productId,
      units: sql<string>`sum(${sals3OrderLines.quantity})`,
    })
    .from(sals3OrderLines)
    .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
    .innerJoin(
      fulfillmentGroups,
      eq(fulfillmentGroups.id, sals3OrderLines.fulfillmentGroupId),
    )
    .where(
      and(
        inArray(sals3OrderLines.productId, productIds),
        eq(sals3Orders.paymentStatus, SOLD_PAYMENT_STATE),
        eq(fulfillmentGroups.parcelState, REVIEWABLE_PARCEL_STATE),
      ),
    )
    .groupBy(sals3OrderLines.productId);

  return new Map(rows.map((row) => [row.productId, toCount(row.units)]));
}
