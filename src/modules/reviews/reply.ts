import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productReviewReplies, productReviews } from '@/lib/db/schema/reviews';
import { auditEvents } from '@/lib/db/schema/catalog';
import type { ReplyRefusal, ReplyToReviewInput } from './contracts';

/**
 * Writes a seller's answer to a review — as a new version, never an update.
 *
 * ## Why versioned
 *
 * PR #80 stored a pricing-override edit as a delete plus a new record. The
 * version chain the schema promised reset, every change audited as a creation,
 * and the history a dispute would have been settled from never recorded that a
 * replacement happened. A public reply a seller can be held to gets the same
 * treatment as a price: the old row is marked `SUPERSEDED`, the new one carries
 * `reply_version + 1` and `supersedes_id`, and both stay readable.
 *
 * ## Why compare-and-set
 *
 * `expectedReplyVersion` is the version the seller's screen rendered, or `null`
 * when it rendered none. Without it, two tabs answering the same review would
 * be resolved by whichever transaction committed second, and the loser's text
 * would vanish with no report. With it, the second one is told.
 *
 * The partial unique index on `(review_id) WHERE status = 'PUBLISHED'` is the
 * backstop underneath: even if this logic were wrong, the database refuses a
 * second live reply.
 */
export type ReplyToReviewResult =
  { ok: true; replyVersion: number } | { ok: false; reason: ReplyRefusal };

export default async function replyToReview(
  input: ReplyToReviewInput & { sellerAccountId: string; actorId: string },
  db: Database = getDb(),
): Promise<ReplyToReviewResult> {
  return db.transaction(async (tx) => {
    // Tenancy and existence in one WHERE: a review belonging to another seller
    // and a review that does not exist produce the same `not_found`, so a
    // seller cannot probe for other people's review ids.
    const reviews = await tx
      .select({ id: productReviews.id })
      .from(productReviews)
      .where(
        and(
          eq(productReviews.id, input.reviewId),
          eq(productReviews.sellerAccountId, input.sellerAccountId),
        ),
      )
      .limit(1);

    if (reviews[0] === undefined) return { ok: false, reason: 'not_found' };

    const existing = await tx
      .select({
        id: productReviewReplies.id,
        replyVersion: productReviewReplies.replyVersion,
      })
      .from(productReviewReplies)
      .where(
        and(
          eq(productReviewReplies.reviewId, input.reviewId),
          eq(productReviewReplies.status, 'PUBLISHED'),
        ),
      )
      .limit(1);

    const current = existing[0] ?? null;
    const currentVersion = current === null ? null : current.replyVersion;

    if (currentVersion !== input.expectedReplyVersion) {
      return { ok: false, reason: 'version_conflict' };
    }

    if (current !== null) {
      // Supersede before inserting: the partial unique index would otherwise
      // reject the new row, and doing it in this order means a rollback leaves
      // the old reply live rather than leaving the review unanswered.
      await tx
        .update(productReviewReplies)
        .set({ status: 'SUPERSEDED' })
        .where(eq(productReviewReplies.id, current.id));
    }

    const nextVersion = currentVersion === null ? 1 : currentVersion + 1;

    const inserted = await tx
      .insert(productReviewReplies)
      .values({
        reviewId: input.reviewId,
        sellerAccountId: input.sellerAccountId,
        authorUserId: input.actorId,
        body: input.body,
        replyVersion: nextVersion,
        supersedesId: current === null ? null : current.id,
      })
      .returning({ replyVersion: productReviewReplies.replyVersion });

    const written = inserted[0]?.replyVersion;

    if (written === undefined) return { ok: false, reason: 'failed' };

    // Audited in the same transaction as the write, so a reply can never exist
    // without a record of who wrote it. The body is not copied into the payload
    // — it is already in a durable, versioned row, and duplicating buyer-facing
    // text into an append-only log means two places to reason about later.
    await tx.insert(auditEvents).values({
      actorId: input.actorId,
      action:
        current === null ? 'review.reply.created' : 'review.reply.replaced',
      entityType: 'ProductReview',
      entityId: input.reviewId,
      payload: {
        sellerAccountId: input.sellerAccountId,
        replyVersion: written,
        supersededReplyId: current === null ? null : current.id,
        bodyLength: input.body.length,
      },
    });

    return { ok: true, replyVersion: written };
  });
}

/** Exported for the action's rate-limit key; not a query. */
export const REPLY_RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };
