// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { decideOnReportedReview } from './moderation';

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';

/**
 * A fake covering the lookup, the optional review update, and the flag update.
 *
 * `update` is one spy for both tables, and the test tells them apart by what
 * was `set` — enough to prove which writes happened and in one place, without
 * a schema-aware fake that would only ever agree with itself.
 */
function executorFor({ found }: { found: boolean }) {
  const limit = vi.fn(() => Promise.resolve(found ? [{ id: REVIEW_ID }] : []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const sets: Record<string, unknown>[] = [];

  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      sets.push(values);

      return {
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: 'flag-1' }])),
          // A review update is awaited without `.returning()`, so the chain has
          // to be thenable at this point too.
          then: (resolve: (value: unknown) => unknown) => resolve(undefined),
        })),
      };
    }),
  }));

  const executor = {
    select,
    update,
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ update }),
    ),
  };

  return { executor, sets, update };
}

describe('decideOnReportedReview', () => {
  it('refuses an unknown review without writing anything', async () => {
    const { executor, update } = executorFor({ found: false });

    await expect(
      decideOnReportedReview(
        { reviewId: REVIEW_ID, decision: 'hide', moderatorUserId: 'mod-1' },
        executor as never,
      ),
    ).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * Both halves or neither. A hidden review whose reports stay open returns to
   * the queue forever; a closed report over a still-published review is a
   * decision nobody can find.
   */
  it('hides the review and closes its reports together', async () => {
    const { executor, sets } = executorFor({ found: true });

    const result = await decideOnReportedReview(
      { reviewId: REVIEW_ID, decision: 'hide', moderatorUserId: 'mod-1' },
      executor as never,
    );

    expect(result).toEqual({ ok: true, decision: 'hide', reportsClosed: 1 });
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ status: 'HIDDEN_BY_PLATFORM' });
    expect(sets[1]).toMatchObject({
      resolution: 'HIDDEN',
      resolvedByUserId: 'mod-1',
    });
  });

  /** Both writes inside one transaction, so a partial decision cannot commit. */
  it('makes the pair atomic', async () => {
    const { executor } = executorFor({ found: true });

    await decideOnReportedReview(
      { reviewId: REVIEW_ID, decision: 'hide', moderatorUserId: 'mod-1' },
      executor as never,
    );

    expect(executor.transaction).toHaveBeenCalledTimes(1);
  });

  /**
   * Keeping must change nothing a shopper sees, or "Keep published" is a lie in
   * the one place it matters most.
   */
  it('keeps the review exactly as it is and still records the decision', async () => {
    const { executor, sets } = executorFor({ found: true });

    const result = await decideOnReportedReview(
      { reviewId: REVIEW_ID, decision: 'keep', moderatorUserId: 'mod-1' },
      executor as never,
    );

    expect(result).toEqual({ ok: true, decision: 'keep', reportsClosed: 1 });
    // One write only — the flags. Nothing set `status`.
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({
      resolution: 'KEPT',
      resolvedByUserId: 'mod-1',
    });
    expect(sets[0]).not.toHaveProperty('status');
  });

  /**
   * `..._resolution_stamped` refuses a resolved flag with no date, so the two
   * have to be written by the same statement — not left to a second update
   * somebody could forget.
   */
  it.each(['hide', 'keep'] as const)(
    'stamps the decision date alongside the resolution on %s',
    async (decision) => {
      const { executor, sets } = executorFor({ found: true });

      await decideOnReportedReview(
        { reviewId: REVIEW_ID, decision, moderatorUserId: 'mod-1' },
        executor as never,
      );

      const flagWrite = sets.at(-1);

      expect(flagWrite?.resolution).not.toBe('OPEN');
      expect(flagWrite?.resolvedAt).toBeInstanceOf(Date);
    },
  );
});
