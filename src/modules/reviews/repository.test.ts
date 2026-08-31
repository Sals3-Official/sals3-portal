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
  buyerName: 'Hezekiah Aranador',
};

const INPUT = {
  orderLineId: 'line-1',
  rating: 5 as const,
  attribution: { kind: 'named' as const },
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

describe('submitReview delivery rating', () => {
  /**
   * The one mistake this whole nullable column exists to prevent. A `0` fails
   * `sals3_product_reviews_delivery_rating_range` outright, and if it somehow
   * did not it would be counted as a one-star verdict on a courier by a buyer
   * who said nothing at all.
   */
  it('writes null, never zero, when the buyer did not answer', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const { executor, values } = insertingExecutor('ok');

    await submitReview(INPUT, executor as never);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryRating: null }),
    );
  });

  it('writes the score the buyer gave when they did answer', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const { executor, values } = insertingExecutor('ok');

    await submitReview(
      { ...INPUT, deliveryRating: 2 as const },
      executor as never,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 5, deliveryRating: 2 }),
    );
  });
});

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

  /**
   * The published name is derived from the order's ship-to, never sent. A
   * caller-supplied string would let anyone publish any name against any
   * purchase.
   */
  it('masks the order’s own ship-to name rather than trusting the request', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({ ok: true, line: LINE });

    const { executor, values } = insertingExecutor('ok');

    await submitReview(
      { ...INPUT, displayName: 'Somebody Else' } as never,
      executor as never,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Hezekiah A.' }),
    );
  });

  it('publishes anonymously when the order has no readable name', async () => {
    asMock(resolveReviewableLine).mockResolvedValue({
      ok: true,
      line: { ...LINE, buyerName: null },
    });

    const { executor, values } = insertingExecutor('ok');

    await submitReview(INPUT, executor as never);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: null }),
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

/**
 * A grouped-rows fake.
 *
 * The two delivery aggregates default to zero so a fixture that says nothing
 * about the delivery score means "nobody answered" — the state every review
 * written before that column existed is in, and one a test about product
 * ratings should not have to restate.
 */
function groupingExecutor(
  rows: {
    productId: string;
    rating: number;
    total: number;
    deliverySum?: number;
    deliveryCount?: number;
  }[],
) {
  const builder: Record<string, unknown> = {};
  const self = (): unknown => builder;

  ['from', 'where'].forEach((name) => {
    builder[name] = vi.fn(self);
  });
  builder.groupBy = vi.fn(() =>
    Promise.resolve(
      rows.map((row) => ({ deliverySum: 0, deliveryCount: 0, ...row })),
    ),
  );

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
      delivery: null,
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
      delivery: null,
    });
  });

  it('reports nothing for a product with no reviews', async () => {
    const executor = groupingExecutor([]);

    const summaries = await readRatingSummaries(['p1'], executor as never);

    expect(summaries.has('p1')).toBe(false);
  });

  /**
   * The whole point of splitting the score. A buyer who waited three weeks for
   * a good product scores the product high and the delivery low, and the two
   * numbers have to stay apart — a folded average would tell the seller their
   * listing is the problem.
   */
  it('averages the delivery score apart from the product score', async () => {
    const executor = groupingExecutor([
      // Four five-star products; two of those buyers scored delivery 2 and 4.
      {
        productId: 'p1',
        rating: 5,
        total: 4,
        deliverySum: 6,
        deliveryCount: 2,
      },
    ]);

    const summary = (await readRatingSummaries(['p1'], executor as never)).get(
      'p1',
    );

    expect(summary?.average).toBe(5);
    expect(summary?.count).toBe(4);
    expect(summary?.delivery).toEqual({ average: 3, count: 2 });
  });

  /**
   * The failure this whole nullable column exists to prevent. Two of forty
   * buyers answering must not read as a delivery score of 0.1, and a reader
   * handed a zero has no way to tell "nobody answered" from "everybody said it
   * was terrible".
   */
  it('divides the delivery score by who answered, not by who reviewed', async () => {
    const executor = groupingExecutor([
      {
        productId: 'p1',
        rating: 5,
        total: 40,
        deliverySum: 8,
        deliveryCount: 2,
      },
    ]);

    expect(
      (await readRatingSummaries(['p1'], executor as never)).get('p1')
        ?.delivery,
    ).toEqual({ average: 4, count: 2 });
  });

  it('reports no delivery score at all when nobody answered', async () => {
    const executor = groupingExecutor([
      { productId: 'p1', rating: 4, total: 12 },
    ]);

    const summary = (await readRatingSummaries(['p1'], executor as never)).get(
      'p1',
    );

    // `null`, never `{ average: 0, count: 0 }` — a nought is a verdict and no
    // verdict was given.
    expect(summary?.delivery).toBeNull();
    expect(summary?.count).toBe(12);
  });

  it('sums the delivery score across every rating bucket', async () => {
    const executor = groupingExecutor([
      {
        productId: 'p1',
        rating: 5,
        total: 2,
        deliverySum: 10,
        deliveryCount: 2,
      },
      {
        productId: 'p1',
        rating: 1,
        total: 2,
        deliverySum: 2,
        deliveryCount: 2,
      },
    ]);

    expect(
      (await readRatingSummaries(['p1'], executor as never)).get('p1')
        ?.delivery,
    ).toEqual({ average: 3, count: 4 });
  });
});
