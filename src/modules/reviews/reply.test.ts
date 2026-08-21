// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import replyToReview from './reply';

/**
 * A fake transaction that records what was selected, updated and inserted.
 *
 * `selects` is consumed in order: the first is the tenancy check on the review,
 * the second is the current live reply.
 */
function fakeTx(selects: unknown[][]) {
  let selectIndex = -1;
  const updates: unknown[] = [];
  const inserts: Record<string, unknown>[] = [];

  const tx = {
    select: vi.fn(() => {
      selectIndex += 1;
      const rows = selects[selectIndex] ?? [];
      const builder: Record<string, unknown> = {};
      const self = (): unknown => builder;

      builder.from = vi.fn(self);
      builder.where = vi.fn(self);
      builder.limit = vi.fn(() => Promise.resolve(rows));

      return builder;
    }),
    update: vi.fn(() => ({
      set: vi.fn((patch: unknown) => ({
        where: vi.fn(() => {
          updates.push(patch);

          return Promise.resolve(undefined);
        }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((row: Record<string, unknown>) => {
        inserts.push({ table, ...row });

        return {
          returning: vi.fn(() =>
            Promise.resolve([{ replyVersion: row.replyVersion }]),
          ),
          then: (resolve: (value: unknown) => unknown) => resolve(undefined),
        };
      }),
    })),
  };

  const db = {
    transaction: vi.fn(async (callback: (inner: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  return { db, tx, updates, inserts };
}

const INPUT = {
  reviewId: 'review-1',
  body: 'Thank you for telling us.',
  sellerAccountId: 'seller-1',
  actorId: 'user-1',
};

describe('replyToReview', () => {
  /**
   * Tenancy and existence answer alike, so a seller cannot probe for other
   * people's review ids by watching which one changes the reply.
   */
  it('answers not_found for a review that is not this seller’s', async () => {
    const { db, tx } = fakeTx([[]]);

    await expect(
      replyToReview({ ...INPUT, expectedReplyVersion: null }, db as never),
    ).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('writes version 1 for a review with no reply', async () => {
    const { db, inserts, updates } = fakeTx([[{ id: 'review-1' }], []]);

    await expect(
      replyToReview({ ...INPUT, expectedReplyVersion: null }, db as never),
    ).resolves.toEqual({ ok: true, replyVersion: 1 });

    expect(updates).toHaveLength(0);
    expect(inserts[0]).toMatchObject({
      reviewId: 'review-1',
      replyVersion: 1,
      supersedesId: null,
      authorUserId: 'user-1',
    });
  });

  /**
   * PR #80's defect, refused here: an edit must supersede rather than replace,
   * so the chain records that a replacement happened.
   */
  it('supersedes the live reply and links the new version to it', async () => {
    const { db, inserts, updates } = fakeTx([
      [{ id: 'review-1' }],
      [{ id: 'reply-1', replyVersion: 1 }],
    ]);

    await expect(
      replyToReview({ ...INPUT, expectedReplyVersion: 1 }, db as never),
    ).resolves.toEqual({ ok: true, replyVersion: 2 });

    expect(updates).toEqual([{ status: 'SUPERSEDED' }]);
    expect(inserts[0]).toMatchObject({
      replyVersion: 2,
      supersedesId: 'reply-1',
    });
  });

  /**
   * Two tabs answering one review. Without the compare-and-set the loser's text
   * would vanish with no report; with it, the second one is told.
   */
  it.each([
    ['a stale version', 1, [{ id: 'reply-1', replyVersion: 2 }]],
    ['a reply that appeared since', null, [{ id: 'reply-1', replyVersion: 1 }]],
    ['a reply that vanished since', 1, []],
  ])('refuses %s as a conflict', async (_label, expected, replyRows) => {
    const { db, tx } = fakeTx([[{ id: 'review-1' }], replyRows]);

    await expect(
      replyToReview({ ...INPUT, expectedReplyVersion: expected }, db as never),
    ).resolves.toEqual({ ok: false, reason: 'version_conflict' });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  /** A reply must never exist without a record of who wrote it. */
  it('audits the write inside the same transaction', async () => {
    const { db, inserts } = fakeTx([[{ id: 'review-1' }], []]);

    await replyToReview({ ...INPUT, expectedReplyVersion: null }, db as never);

    const audit = inserts.find((row) => row.action !== undefined);

    expect(audit).toMatchObject({
      actorId: 'user-1',
      action: 'review.reply.created',
      entityType: 'ProductReview',
      entityId: 'review-1',
    });
  });

  it('names a replacement differently from a first reply in the audit trail', async () => {
    const { db, inserts } = fakeTx([
      [{ id: 'review-1' }],
      [{ id: 'reply-1', replyVersion: 1 }],
    ]);

    await replyToReview({ ...INPUT, expectedReplyVersion: 1 }, db as never);

    expect(inserts.find((row) => row.action !== undefined)?.action).toBe(
      'review.reply.replaced',
    );
  });

  /** Buyer-facing text stays in one durable place, not duplicated into a log. */
  it('does not copy the reply text into the audit payload', async () => {
    const { db, inserts } = fakeTx([[{ id: 'review-1' }], []]);

    await replyToReview({ ...INPUT, expectedReplyVersion: null }, db as never);

    const audit = inserts.find((row) => row.action !== undefined);

    expect(JSON.stringify(audit?.payload)).not.toContain('Thank you');
  });
});
