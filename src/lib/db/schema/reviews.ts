import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { products } from './product-catalog';
import { sals3OrderLines, sals3Orders } from './orders';
import { sellerAccounts } from './seller-accounts';

/**
 * Buyer product reviews.
 *
 * ## Eligibility is derived, never stored
 *
 * There is no `review_invitations` table and no flag on the order line. A buyer
 * may review an item when that item's own `fulfillment_groups.parcel_state` is
 * `DELIVERED` — the reconciled Sals3 state, not CJ's raw status and not
 * `carrier_delivered_at`. `TRACKING_CONFLICT` is deliberately **not** eligible:
 * ADR-004 §5 gives that state to a carrier "delivered" the supplier disputes,
 * which means nobody yet knows the item arrived. A second table holding
 * "eligible" would be a second source of truth able to disagree with the parcel
 * it describes, and the parcel is the fact.
 *
 * ## One review per order line
 *
 * `sals3_product_reviews_line_key` is the whole abuse model. Not per product
 * (a buyer who ordered twice has two things to say and both are real), not per
 * order (an order carries many items), and not per unit — quantity 2 on one
 * line is still one line and one review.
 *
 * ## Nothing here is added to `sals3_order_lines`
 *
 * The relationship is held on this side only. Drizzle names every column of a
 * schema in an `INSERT`, and both order-line readers use a bare `.select()`, so
 * adding a column to `sals3_order_lines` changes the SQL every writer of the
 * money path emits — see `orders/migrate-order-line-snapshot.ts` and
 * `order-line-columns.test.ts`. A new table cannot do that to an existing
 * writer, which is why this migration is allowed to ship its Drizzle schema and
 * its DDL together where the snapshot column was not.
 *
 * ## Ratings gate nothing
 *
 * ADR-010 reserves `products.score` and leaves it unwritten. A rating must not
 * become a publication input, an evaluation signal, or a ranking key without its
 * own owner decision. Nothing in this module writes to `products`.
 *
 * ## Supplier reviews are not these reviews
 *
 * CJ's `listedNum` and `/product/productComments` are supplier-platform
 * evidence about a supplier's own marketplace, and the wiki's corrected
 * external facts are explicit that they are not Sals3 ratings. No row here ever
 * originates from a supplier, and no supplier call is made to produce one
 * (ADR-013 §7, ADR-017).
 */
export const productReviewStatusEnum = pgEnum('product_review_status', [
  /** Visible to buyers and counted in the product's average. */
  'PUBLISHED',
  /**
   * Withheld by a platform actor holding `review:moderate`. Not projected to
   * the storefront and not counted. Deliberately not reachable by the seller:
   * ADR-014 puts platform moderation in the Admin Portal, and a seller who can
   * hide criticism of their own listing makes every remaining rating a
   * marketing claim rather than evidence.
   */
  'HIDDEN_BY_PLATFORM',
]);

export const productReviewReplyStatusEnum = pgEnum(
  'product_review_reply_status',
  ['PUBLISHED', 'SUPERSEDED'],
);

export const productReviews = pgTable(
  'sals3_product_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The line this review is about. `restrict` because an order line is the
     * evidence that the review is allowed to exist — deleting it would leave a
     * review nothing proves.
     */
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => sals3OrderLines.id, { onDelete: 'restrict' }),

    orderId: uuid('order_id')
      .notNull()
      .references(() => sals3Orders.id, { onDelete: 'restrict' }),

    /**
     * The live product the review is displayed on. This one carries a real
     * foreign key, unlike `sals3_order_lines.product_id`, because the storefront
     * joins it on every product page — the order line deliberately has no key so
     * a purchase record can outlive the catalogue row, and a review has no such
     * requirement.
     */
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),

    /**
     * Which variant was bought. Plain `uuid` with no foreign key, matching
     * `sals3_order_lines.variant_id`: a seller may retire a variant, and that
     * must not be blocked by, or destroy, a review of it.
     */
    variantId: uuid('variant_id'),

    /**
     * The account that sold the item, resolved at write time from the line's
     * fulfillment group through `supplier_connections.seller_account_id` — the
     * same join the eligibility check already performs, so this costs nothing
     * extra. Denormalised so the Seller Center list is one indexed equality
     * rather than a four-table walk on every page.
     *
     * Equal to `products.steward_seller_account_id` today. Stored from the order
     * rather than read from the product because it records the transaction that
     * actually happened; if listing stewardship ever transfers between accounts,
     * that is a decision about this column, not a silent reinterpretation of it.
     */
    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),

    /**
     * Lower-cased, and matched against `sals3_orders.buyer_email` the same way
     * `buyer-read.ts` does. This is authorisation data: it decides who may edit
     * or delete this review. It is **never** projected to the storefront read
     * model or to the Seller Center — the seller sees `display_name`, and rule
     * 35 keeps an address out of logs.
     */
    buyerEmail: text('buyer_email').notNull(),

    /**
     * The name to show, stored **already masked** — the literal string the buyer
     * consented to at submit time ("Hezekiah A."), not their full name reduced
     * at read time. Two reasons: a read path cannot leak a surname it was never
     * given, and the masking rule is applied once at the boundary where the
     * choice was made instead of being re-derived by every future consumer.
     *
     * `null` means the buyer chose to stay anonymous. Readers render their own
     * wording for that; no display string is stored for it, because storing
     * "A Sals3 customer" would make a copy change a data migration.
     */
    displayName: text('display_name'),

    rating: smallint('rating').notNull(),

    /** Optional. A rating with no words is a complete review. */
    body: text('body'),

    status: productReviewStatusEnum('status').notNull().default('PUBLISHED'),

    /**
     * When the parcel carrying this line reached `DELIVERED`, copied in at write
     * time. Frozen evidence of why the review was permitted, and the anchor the
     * edit window is measured from — a later status-sync correction must not
     * silently move a buyer's deadline.
     */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /** One review per purchased line. The abuse model, in one index. */
    uniqueIndex('sals3_product_reviews_line_key').on(table.orderLineId),

    /** The product page's list and its average. */
    index('sals3_product_reviews_product_idx').on(
      table.productId,
      table.status,
      table.createdAt,
    ),

    /** The Seller Center list, newest first, one tenant. */
    index('sals3_product_reviews_seller_idx').on(
      table.sellerAccountId,
      table.createdAt,
    ),

    /** "My reviews", and the lookup an edit authorises against. */
    index('sals3_product_reviews_buyer_idx').on(table.buyerEmail),

    check(
      'sals3_product_reviews_rating_range',
      sql`${table.rating} between 1 and 5`,
    ),

    /**
     * Zod validates the same ceiling on the way in. Repeated here because a
     * schema check is the only limit that still holds when a future writer
     * forgets the validator.
     */
    check(
      'sals3_product_reviews_body_length',
      sql`${table.body} is null or char_length(${table.body}) <= 1000`,
    ),

    check(
      'sals3_product_reviews_display_name_length',
      sql`${table.displayName} is null or char_length(${table.displayName}) between 1 and 60`,
    ),

    /** A stored address that is not lower-cased would never match a lookup. */
    check(
      'sals3_product_reviews_buyer_email_lowercase',
      sql`${table.buyerEmail} = lower(${table.buyerEmail})`,
    ),
  ],
);

/**
 * The seller's answer to a review.
 *
 * Versioned rather than updated in place. PR #80 shipped the opposite on
 * pricing overrides — an edit was stored as a delete plus a new record, which
 * reset the version chain the schema promised and audited every change as a
 * creation, so the history a dispute would be settled from never recorded that
 * a replacement had happened. A reply is public text a seller can be held to;
 * it gets the same treatment as a price.
 */
export const productReviewReplies = pgTable(
  'sals3_product_review_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    reviewId: uuid('review_id')
      .notNull()
      .references(() => productReviews.id, { onDelete: 'restrict' }),

    /**
     * Denormalised tenant, same reason as on the review: the Seller Center
     * filters on it, and a reply must never be readable or writable across
     * accounts through its review id alone.
     */
    sellerAccountId: uuid('seller_account_id')
      .notNull()
      .references(() => sellerAccounts.id, { onDelete: 'restrict' }),

    /**
     * The Better Auth user id of the person who wrote it, captured at write
     * time. Deliberately **not** a foreign key to `auth_users`: the Admin
     * Portal's audit trail learned that `ON DELETE RESTRICT` on an actor column
     * means an account that has ever acted can never be removed, only
     * deactivated. A public reply must stay readable regardless of what later
     * happens to the staff account that wrote it.
     */
    authorUserId: text('author_user_id').notNull(),

    body: text('body').notNull(),

    replyVersion: integer('reply_version').notNull().default(1),

    /** The version this one replaced. `null` for the first. */
    supersedesId: uuid('supersedes_id'),

    status: productReviewReplyStatusEnum('status')
      .notNull()
      .default('PUBLISHED'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * At most one live reply per review, enforced by the database rather than by
     * the writer remembering to supersede the old one first.
     */
    uniqueIndex('sals3_product_review_replies_active_key')
      .on(table.reviewId)
      .where(sql`${table.status} = 'PUBLISHED'`),

    /** A retried edit collides instead of forking the chain. */
    uniqueIndex('sals3_product_review_replies_version_key').on(
      table.reviewId,
      table.replyVersion,
    ),

    index('sals3_product_review_replies_seller_idx').on(table.sellerAccountId),

    check(
      'sals3_product_review_replies_version_positive',
      sql`${table.replyVersion} >= 1`,
    ),

    check(
      'sals3_product_review_replies_body_length',
      sql`char_length(${table.body}) between 1 and 1000`,
    ),
  ],
);
