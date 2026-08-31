import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import { sals3OrderLines } from '@/lib/db/schema/orders';
import {
  productReviewFlags,
  productReviewPhotos,
  productReviews,
} from '@/lib/db/schema/reviews';
import {
  type ModerateReviewInput,
  type ModerationRefusal,
  type ReviewFlagReason,
  type ReviewRating,
} from './contracts';

/**
 * The platform moderation queue: reviews buyers have asked someone to look at.
 *
 * ## Where this lives, and why not the Admin Portal
 *
 * ADR-014 puts platform moderation in the Admin Portal. That repository is
 * sign-in and shell only — no capability is built there — so a queue placed
 * "correctly" today would be a queue nobody can open, and a report button with
 * no queue behind it is a promise the platform is not keeping.
 *
 * So this ships in the Portal behind **`review:moderate`**, a permission that
 * already existed in `PORTAL_PERMISSIONS` and that **no seller role holds** —
 * only `admin` and `catalogue_reviewer`. The ADR's substance is that a seller
 * must never be able to hide criticism of their own listing, and that is
 * enforced here by the permission rather than by the repository the page is
 * served from. When the Admin Portal grows real capabilities this moves, and
 * the move is a routing change rather than a rethink.
 *
 * ## Nothing here is tenant-scoped, on purpose
 *
 * Every other read in this module filters `seller_account_id` against a
 * session-resolved id. This one deliberately does not: a platform moderator
 * looks across sellers, and scoping the queue to the moderator's own account
 * would hide exactly the reviews they exist to see. The gate is the permission,
 * checked by the caller before this function is reached.
 */

export type ReportedReview = {
  reviewId: string;
  rating: ReviewRating;
  deliveryRating: ReviewRating | null;
  body: string | null;
  displayName: string | null;
  createdAt: string;
  productId: string;
  productTitle: string;
  /** How many photos the review carries. A moderator reads them on the page. */
  photoCount: number;
  /**
   * Distinct people who reported it — the unique index makes that the same as
   * the row count, which is the whole reason the index exists.
   */
  reportCount: number;
  /** Every reason given, most-reported first, with how many gave it. */
  reasons: { reason: ReviewFlagReason; count: number }[];
  /** When the first report arrived. The queue is ordered by this. */
  firstReportedAt: string;
};

export type ReportedReviewPage = {
  rows: ReportedReview[];
  /** Reviews with at least one open report, not reports. */
  total: number;
};

/**
 * The reasons given, per review, most-reported first.
 *
 * A second statement rather than another join, for the same reason
 * `listPublicReviewsBySlug` reads photos separately: joining a one-to-many to a
 * paged query makes `LIMIT` bound the wrong thing.
 *
 * **`reporter_email` is not selected.** It is authorisation data, and a
 * moderator deciding whether a review breaks a rule does not need to know who
 * objected — the reason and the count are the case. The column exists so the
 * unique index can stop one person filing a hundred reports, not so anybody can
 * read a list of complainants.
 */
async function readOpenReasonsFor(
  reviewIds: string[],
  executor: DbExecutor,
): Promise<Map<string, { reason: ReviewFlagReason; count: number }[]>> {
  if (reviewIds.length === 0) return new Map();

  const rows = await executor
    .select({
      reviewId: productReviewFlags.reviewId,
      reason: productReviewFlags.reason,
      total: sql<number>`count(*)::int`,
    })
    .from(productReviewFlags)
    .where(
      and(
        inArray(productReviewFlags.reviewId, reviewIds),
        eq(productReviewFlags.resolution, 'OPEN'),
      ),
    )
    .groupBy(productReviewFlags.reviewId, productReviewFlags.reason);

  const byReview = new Map<
    string,
    { reason: ReviewFlagReason; count: number }[]
  >();

  rows.forEach((row) => {
    const existing = byReview.get(row.reviewId) ?? [];

    existing.push({ reason: row.reason, count: row.total });
    byReview.set(row.reviewId, existing);
  });

  byReview.forEach((list) => list.sort((a, b) => b.count - a.count));

  return byReview;
}

/**
 * Open reports, grouped into one row per review, oldest first.
 *
 * Oldest first rather than most-reported first: a queue sorted by volume lets a
 * coordinated group jump the line, and the thing that actually needs bounding
 * is how long any single buyer waits for an answer.
 */
export async function listReportedReviews(
  input: { page: number; limit: number },
  executor: DbExecutor = getDb(),
): Promise<ReportedReviewPage> {
  const openFlags = executor
    .select({
      reviewId: productReviewFlags.reviewId,
      reportCount: count().as('report_count'),
      firstReportedAt: sql<Date>`min(${productReviewFlags.createdAt})`.as(
        'first_reported_at',
      ),
    })
    .from(productReviewFlags)
    .where(eq(productReviewFlags.resolution, 'OPEN'))
    .groupBy(productReviewFlags.reviewId)
    .as('open_flags');

  const [rows, totals] = await Promise.all([
    executor
      .select({
        reviewId: productReviews.id,
        rating: productReviews.rating,
        deliveryRating: productReviews.deliveryRating,
        body: productReviews.body,
        displayName: productReviews.displayName,
        createdAt: productReviews.createdAt,
        productId: productReviews.productId,
        productTitle: sals3OrderLines.title,
        photoCount: sql<number>`(
          select count(*)::int from ${productReviewPhotos}
          where ${productReviewPhotos.reviewId} = ${productReviews.id}
        )`,
        reportCount: openFlags.reportCount,
        firstReportedAt: openFlags.firstReportedAt,
      })
      .from(openFlags)
      .innerJoin(productReviews, eq(productReviews.id, openFlags.reviewId))
      .innerJoin(
        sals3OrderLines,
        eq(sals3OrderLines.id, productReviews.orderLineId),
      )
      .orderBy(asc(openFlags.firstReportedAt))
      .limit(input.limit)
      .offset((input.page - 1) * input.limit),
    executor
      .select({
        total: sql<number>`count(distinct ${productReviewFlags.reviewId})::int`,
      })
      .from(productReviewFlags)
      .where(eq(productReviewFlags.resolution, 'OPEN')),
  ]);

  const reasons = await readOpenReasonsFor(
    rows.map((row) => row.reviewId),
    executor,
  );

  return {
    rows: rows.map((row) => ({
      reviewId: row.reviewId,
      rating: row.rating as ReviewRating,
      deliveryRating:
        row.deliveryRating === null
          ? null
          : (row.deliveryRating as ReviewRating),
      body: row.body,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
      productId: row.productId,
      productTitle: row.productTitle,
      photoCount: row.photoCount,
      reportCount: row.reportCount,
      reasons: reasons.get(row.reviewId) ?? [],
      firstReportedAt: new Date(row.firstReportedAt).toISOString(),
    })),
    total: totals[0]?.total ?? 0,
  };
}

/** Photos on one reported review, so a moderator can see what they are deciding. */
export async function readReportedReviewPhotos(
  reviewId: string,
  executor: DbExecutor = getDb(),
): Promise<{ url: string; width: number; height: number }[]> {
  const rows = await executor
    .select({
      url: productReviewPhotos.imageUrl,
      width: productReviewPhotos.widthPixels,
      height: productReviewPhotos.heightPixels,
    })
    .from(productReviewPhotos)
    .where(eq(productReviewPhotos.reviewId, reviewId))
    .orderBy(asc(productReviewPhotos.position));

  return rows;
}

export type ModerationResult =
  | { ok: true; decision: 'hide' | 'keep'; reportsClosed: number }
  | { ok: false; reason: ModerationRefusal };

/**
 * Records a moderator's decision, and applies it.
 *
 * ## Both halves, or neither
 *
 * `hide` writes `HIDDEN_BY_PLATFORM` **and** closes the reports; `keep` closes
 * the reports and leaves the review exactly as it is. One transaction, because
 * a hidden review with its reports still open comes back to the queue forever,
 * and a closed report over a still-published review is a decision nobody can
 * find. The pair is the decision; either alone is a bug with a paper trail.
 *
 * ## Why `keep` writes anything at all
 *
 * It would be simpler to leave a rejected report open and let it age out. But
 * then a moderator who has already looked at a review sees it again tomorrow,
 * and no record exists that anybody ever considered it. A decision that leaves
 * no trace is indistinguishable from an unread queue.
 *
 * ## The reports are closed by `review_id`, not by the ids the page rendered
 *
 * A report filed between the moderator loading the page and pressing the button
 * is about the same review and the same decision, so it closes too. Closing
 * only the rows the screen knew about would leave the review in the queue for a
 * decision that has already been made.
 */
export async function decideOnReportedReview(
  input: ModerateReviewInput & { moderatorUserId: string },
  executor: DbExecutor = getDb(),
): Promise<ModerationResult> {
  const decidedAt = new Date();

  const review = await executor
    .select({ id: productReviews.id })
    .from(productReviews)
    .where(eq(productReviews.id, input.reviewId))
    .limit(1);

  if (review.length === 0) return { ok: false, reason: 'not_found' };

  const closed = await executor.transaction(async (tx) => {
    if (input.decision === 'hide') {
      await tx
        .update(productReviews)
        .set({ status: 'HIDDEN_BY_PLATFORM', updatedAt: decidedAt })
        .where(eq(productReviews.id, input.reviewId));
    }

    const resolved = await tx
      .update(productReviewFlags)
      .set({
        resolution: input.decision === 'hide' ? 'HIDDEN' : 'KEPT',
        resolvedByUserId: input.moderatorUserId,
        // Written in the same statement as `resolution`, because
        // `..._resolution_stamped` refuses the two apart.
        resolvedAt: decidedAt,
      })
      .where(
        and(
          eq(productReviewFlags.reviewId, input.reviewId),
          eq(productReviewFlags.resolution, 'OPEN'),
        ),
      )
      .returning({ id: productReviewFlags.id });

    return resolved.length;
  });

  return { ok: true, decision: input.decision, reportsClosed: closed };
}
