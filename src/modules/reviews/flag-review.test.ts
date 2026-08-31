// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import flagReview from './flag-review';

const INPUT = {
  reviewId: '11111111-1111-4111-8111-111111111111',
  reason: 'OFF_TOPIC' as const,
  reporterEmail: 'Reporter@Example.com',
};

/**
 * A fake with two halves: the `PUBLISHED` lookup, then the insert.
 *
 * `found` false stands for every case that lookup collapses — no such review,
 * and one a moderator has already hidden.
 */
function executorFor({
  found,
  insert = 'ok',
}: {
  found: boolean;
  insert?: 'ok' | 'duplicate' | 'empty';
}) {
  const limit = vi.fn(() => Promise.resolve(found ? [{ id: 'review-1' }] : []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const values = vi.fn(() => ({
    returning: vi.fn(() => {
      if (insert === 'duplicate') {
        return Promise.reject(
          Object.assign(new Error('duplicate'), { code: '23505' }),
        );
      }

      return Promise.resolve(insert === 'empty' ? [] : [{ id: 'flag-1' }]);
    }),
  }));
  const insertFn = vi.fn(() => ({ values }));

  return { executor: { select, insert: insertFn }, values, insert: insertFn };
}

describe('flagReview', () => {
  it('records the report and returns its id', async () => {
    const { executor } = executorFor({ found: true });

    await expect(flagReview(INPUT, executor as never)).resolves.toEqual({
      ok: true,
      flagId: 'flag-1',
    });
  });

  /**
   * The unique index only enforces one-per-person if the two values compare
   * equal, and the column's own CHECK refuses anything else.
   */
  it('lower-cases the reporter before it is stored or compared', async () => {
    const { executor, values } = executorFor({ found: true });

    await flagReview(INPUT, executor as never);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ reporterEmail: 'reporter@example.com' }),
    );
  });

  /**
   * The heart of the feature: a report is a request for a look, never an
   * action. A competitor with four accounts must not be able to erase a rating.
   */
  it('never touches the review it reports', async () => {
    const update = vi.fn();
    const { executor } = executorFor({ found: true });

    await flagReview(INPUT, { ...executor, update } as never);

    expect(update).not.toHaveBeenCalled();
  });

  it('leaves resolution and the decision date to the moderator', async () => {
    const { executor, values } = executorFor({ found: true });

    await flagReview(INPUT, executor as never);

    const written = values.mock.calls.at(0)?.at(0) as unknown as Record<
      string,
      unknown
    >;

    // Absent, so the column default (`OPEN`) and a null date are what land —
    // the only pair `..._resolution_stamped` accepts for an open report.
    expect(written).not.toHaveProperty('resolution');
    expect(written).not.toHaveProperty('resolvedAt');
    expect(written).not.toHaveProperty('resolvedByUserId');
  });

  it('refuses a review that is not published, without inserting', async () => {
    const { executor, insert } = executorFor({ found: false });

    await expect(flagReview(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(insert).not.toHaveBeenCalled();
  });

  /** The durable one-per-person guard, which no amount of concurrency gets past. */
  it('reports a second attempt by the same person as already reported', async () => {
    const { executor } = executorFor({ found: true, insert: 'duplicate' });

    await expect(flagReview(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'already_reported',
    });
  });

  it('refuses an empty reporter rather than writing an unattributable report', async () => {
    const { executor, insert } = executorFor({ found: true });

    await expect(
      flagReview({ ...INPUT, reporterEmail: '  ' }, executor as never),
    ).resolves.toEqual({ ok: false, reason: 'invalid_input' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('rethrows anything that is not a duplicate', async () => {
    const values = vi.fn(() => ({
      returning: vi.fn(() =>
        Promise.reject(new Error('connection terminated')),
      ),
    }));
    const { executor } = executorFor({ found: true });

    await expect(
      flagReview(INPUT, {
        ...executor,
        insert: vi.fn(() => ({ values })),
      } as never),
    ).rejects.toThrow('connection terminated');
  });
});
