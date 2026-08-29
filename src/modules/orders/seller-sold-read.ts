import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import { sals3OrderLines, sals3Orders } from '@/lib/db/schema/orders';
import { products } from '@/lib/db/schema/product-catalog';
import { productReviews } from '@/lib/db/schema/reviews';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';

/**
 * How many of each thing the seller has actually sold.
 *
 * ## Why this needs no new column and no supplier call
 *
 * Every fact is already on rows this database holds. `sals3_order_lines` freezes
 * `product_id`, `variant_id`, `quantity` and `unit_amount_minor` at acceptance
 * (ADR-007), and `sals3_orders.payment_status` says whether the money stood.
 * Counting is therefore a `GROUP BY` over rows that exist, with no DDL, no
 * denormalised counter to drift, and no CJ request — which the operating
 * contract's §9 call budget requires us to check before writing any new read.
 *
 * ## Tenancy goes through the line, not the parcel
 *
 * `sals3_order_lines.supplier_connection_id` is `NOT NULL` and points straight
 * at the connection whose `seller_account_id` owns the sale, so scoping is one
 * join and one equality. This deliberately does **not** route through
 * `fulfillment_groups` the way `reviews/seller-read.ts` must: that column is
 * nullable, so an inner join through it would silently drop any line not yet
 * grouped into a parcel — understating the seller's own sales, which is the one
 * error this module must not make.
 *
 * ## "Sold" means the payment stood
 *
 * Only `PAID` counts. `REFUNDED` and `DISPUTED` lines are excluded, which means
 * a sold count can go **down** — every surface that renders one has to say so,
 * or a seller reads a correct decrement as a bug. `refundedUnits` is returned
 * beside the total precisely so that drop is reconcilable rather than mysterious.
 *
 * ## Reviews are counted separately, on purpose
 *
 * Joining `sals3_product_reviews` into the aggregate below would fan each order
 * line out into one row per review and multiply every quantity by it. The review
 * tallies are their own query, merged by product id in JavaScript. This is the
 * same hazard `order-line-snapshot` documented for bare `.select()` on this
 * table, in a different disguise.
 */

/** Mirrors `orderPaymentStatusEnum`. Kept as a union so `inArray` stays typed. */
type OrderPaymentStatus = 'PAID' | 'REFUNDED' | 'DISPUTED';

/** Payment states that count as a sale. */
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
};

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
 * The window a figure covers. Both bounds optional; `to` is **exclusive**, so
 * the caller has already pushed an inclusive end-date to the following midnight.
 */
export type SoldDateRange = { from: Date | null; to: Date | null };

export const WHOLE_HISTORY: SoldDateRange = { from: null, to: null };

/**
 * Filtered on `sals3_orders.created_at` — when the order was accepted, which is
 * when the money cleared and therefore when the sale happened. Deliberately not
 * the parcel's delivery date: that would move a sale between months depending on
 * how long CJ took to ship it, and a seller reconciling August would find August
 * changing under them.
 *
 * Plain `gte`/`lt` operators rather than a `sql` template: a value interpolated
 * into a template has no column context, skips `mapToDriverValue`, and reaches
 * the driver as a raw `Date` the query then rejects.
 */
function sellerScope(
  sellerAccountId: string,
  paymentStates: readonly OrderPaymentStatus[],
  range: SoldDateRange,
) {
  return and(
    eq(supplierConnections.sellerAccountId, sellerAccountId),
    inArray(sals3Orders.paymentStatus, [...paymentStates]),
    range.from === null ? undefined : gte(sals3Orders.createdAt, range.from),
    range.to === null ? undefined : lt(sals3Orders.createdAt, range.to),
  );
}

/** Per-product sales, richest first. Reviews are merged in, never joined. */
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
      .leftJoin(products, eq(products.id, sals3OrderLines.productId))
      .where(sellerScope(sellerAccountId, [SOLD_PAYMENT_STATE], range))
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
  const [totals, revenue, reversed] = await Promise.all([
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
      .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
      .where(sellerScope(sellerAccountId, [SOLD_PAYMENT_STATE], range)),

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
      .where(sellerScope(sellerAccountId, [SOLD_PAYMENT_STATE], range))
      .groupBy(sals3OrderLines.currency),

    executor
      .select({
        units: sql<string>`coalesce(sum(${sals3OrderLines.quantity}), 0)`,
      })
      .from(sals3OrderLines)
      .innerJoin(
        supplierConnections,
        eq(supplierConnections.id, sals3OrderLines.supplierConnectionId),
      )
      .innerJoin(sals3Orders, eq(sals3Orders.id, sals3OrderLines.orderId))
      .where(sellerScope(sellerAccountId, REVERSED_PAYMENT_STATES, range)),
  ]);

  return {
    totalUnits: toCount(totals[0]?.units),
    distinctOrders: toCount(totals[0]?.orders),
    productCount: toCount(totals[0]?.productCount),
    revenueByCurrency: revenue
      .map((row) => ({
        currency: row.currency,
        revenueMinor: toCount(row.revenueMinor),
      }))
      .sort((left, right) => right.revenueMinor - left.revenueMinor),
    refundedUnits: toCount(reversed[0]?.units),
  };
}

/**
 * Units sold per product for a set of product ids, for the storefront card.
 *
 * Deliberately separate from `readSellerSoldRows`: that one is the seller's own
 * view and carries revenue, which must never cross into a buyer-facing payload.
 * This returns counts only, and is not seller-scoped — a shopper's card shows
 * how many of that product sold, whoever the steward is.
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
    .where(
      and(
        inArray(sals3OrderLines.productId, productIds),
        eq(sals3Orders.paymentStatus, SOLD_PAYMENT_STATE),
      ),
    )
    .groupBy(sals3OrderLines.productId);

  return new Map(rows.map((row) => [row.productId, toCount(row.units)]));
}
