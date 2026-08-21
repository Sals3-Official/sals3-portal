// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('./eligibility', () => ({ default: vi.fn() }));

/* eslint-disable import/first */
import resolveReviewableLine from './eligibility';
import { readRatingSummaries, submitReview } from './repository';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const LINE = {
  orderLineId: 'line-1',
  orderId: 'order-1',
  productId: 'product-1',
  variantId: 'variant-1',
  sellerAccountId: 'seller-1',
  deliveredAt: new Date('2026-08-17T00:00:00.000Z'),
};

const INPUT = {
  orderLineId: 'line-1',
  rating: 5 as const,
  attribution: { kind: 'named' as const, displayName: 'Hezekiah A.' },
  buyerEmail: 'Buyer@Example.com',
};

function insertingExecutor(behaviour: 'ok' | 'duplicate' | 'empty') {
  const values = vi.fn(() => ({
    returning: vi.fn(() => {
      if (behaviour === 'duplicate') {
        return Promise.reject(
          Object.assign(new Error('duplicate'), { code: '23505' }),
        );
      }

      return Promise.resolve(behaviour === 'empty' ? [] : [{ id: 'review-1' }]);
    }),
  }));

  return { executor: { insert: vi.fn(() => ({ values })) }, values };
}

describe('submitReview', () => {
  /** Authorisation is the resolver's job, and a refusal must not reach a write. */
  it.each(['not_eligible', 'already_reviewed'] as const)(
    'passes through %s without inserting',
    async (reason) => {
      asMock(resolveReviewableLine).mockResolvedValue({ ok: false, reason });

      const { executor } = insertingExecutor('ok');

      await expect(submitReview(INPUT, executor as never)).resolves.toEqual({
        ok: false,
        reason,
      });
      expect(executor.insert).not.toHaveBeenCalled();
    },
  );

  it('stores the line the resolver returned, never the caller-supplied ids', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const { executor, values } = insertingExecutor('ok');

    await expect(submitReview(INPUT, executor as never)).resolves.toEqual({
      ok: true,
      reviewId: 'review-1',
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        orderLineId: LINE.orderLineId,
        productId: LINE.productId,
        sellerAccountId: LINE.sellerAccountId,
        deliveredAt: LINE.deliveredAt,
      }),
    );
  });

  /** The column's own CHECK requires it, and every lookup compares it that way. */
  it('lower-cases the stored address', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const { executor, values } = insertingExecutor('ok');

    await submitReview(INPUT, executor as never);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ buyerEmail: 'buyer@example.com' }),
    );
  });

  it('stores no name at all for an anonymous review', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const { executor, values } = insertingExecutor('ok');

    await submitReview(
      { ...INPUT, attribution: { kind: 'anonymous' } },
      executor as never,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: null }),
    );
  });

  /** "Wrote nothing" and "wrote and cleared it" must not be two states. */
  it.each([undefined, ''])('stores body %j as null', async (body) => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const { executor, values } = insertingExecutor('ok');

    await submitReview({ ...INPUT, body }, executor as never);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ body: null }),
    );
  });

  /**
   * The double-tap case. The resolver saw no review, the index did — which is
   * the only thing standing between a slow connection and two reviews on one
   * purchase.
   */
  it('turns a unique violation into already_reviewed, not a crash', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const { executor } = insertingExecutor('duplicate');

    await expect(submitReview(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'already_reviewed',
    });
  });

  it('does not swallow an unrelated database error', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const executor = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() =>
            Promise.reject(new Error('connection refused')),
          ),
        })),
      })),
    };

    await expect(submitReview(INPUT, executor as never)).rejects.toThrow(
      'connection refused',
    );
  });
});

function groupingExecutor(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const self = (): unknown => builder;

  ['from', 'where'].forEach((name) => {
    builder[name] = vi.fn(self);
  });
  builder.groupBy = vi.fn(() => Promise.resolve(rows));

  return { select: vi.fn(() => builder) };
}

describe('readRatingSummaries', () => {
  it('does not query for an empty product list', async () => {
    const executor = groupingExecutor([]);

    await expect(readRatingSummaries([], executor as never)).resolves.toEqual(
      new Map(),
    );
    expect(executor.select).not.toHaveBeenCalled();
  });

  it('averages a mixed distribution to one decimal', async () => {
    const executor = groupingExecutor([
      { productId: 'p1', rating: 5, total: 16 },
      { productId: 'p1', rating: 4, total: 3 },
      { productId: 'p1', rating: 3, total: 2 },
      { productId: 'p1', rating: 2, total: 1 },
    ]);

    const summaries = await readRatingSummaries(['p1'], executor as never);

    // (16*5 + 3*4 + 2*3 + 1*2) / 22 = 100/22 = 4.545...
    expect(summaries.get('p1')).toEqual({
      average: 4.5,
      count: 22,
      breakdown: [0, 1, 2, 3, 16],
    });
  });

  it('keeps products apart', async () => {
    const executor = groupingExecutor([
      { productId: 'p1', rating: 5, total: 2 },
      { productId: 'p2', rating: 1, total: 4 },
    ]);

    const summaries = await readRatingSummaries(
      ['p1', 'p2'],
      executor as never,
    );

    expect(summaries.get('p1')?.average).toBe(5);
    expect(summaries.get('p2')?.average).toBe(1);
    expect(summaries.get('p2')?.count).toBe(4);
  });

  /**
   * A rating outside 1-5 cannot exist — the CHECK forbids it — so its presence
   * means the constraint was bypassed. Dropped rather than clamped: folding a
   * 7 into the five-star bar would quietly inflate the one number this table
   * exists to state honestly.
   */
  it('drops an impossible rating instead of inflating the average', async () => {
    const executor = groupingExecutor([
      { productId: 'p1', rating: 5, total: 1 },
      { productId: 'p1', rating: 7, total: 99 },
    ]);

    expect(
      (await readRatingSummaries(['p1'], executor as never)).get('p1'),
    ).toEqual({
      average: 5,
      count: 1,
      breakdown: [0, 0, 0, 0, 1],
    });
  });

  it('reports nothing for a product with no reviews', async () => {
    const executor = groupingExecutor([]);

    const summaries = await readRatingSummaries(['p1'], executor as never);

    expect(summaries.has('p1')).toBe(false);
  });
});
