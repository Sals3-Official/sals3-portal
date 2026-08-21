// @vitest-environment node
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import resolveReviewableLine, { listLineReviewStates } from './eligibility';

/**
 * Eligibility is a `WHERE` clause or it is not a gate.
 *
 * These tests render the real SQL Drizzle would send — `String(sqlObject)`
 * would render `"[object Object]"` and pass vacuously — and assert what a
 * behavioural test against canned rows cannot: that the predicate itself
 * carries every condition. A fake that returns a row proves the mapping, not
 * the authorisation.
 *
 * Same technique as `read-model.published-scope.test.ts`, for the same reason:
 * this clause is the only thing between a verified email header and a write.
 */

const dialect = new PgDialect();

function recordingExecutor(rows: unknown[]) {
  const recorded: string[] = [];

  const builder: Record<string, unknown> = {};
  const self = (): unknown => builder;

  ['from', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy'].forEach((name) => {
    builder[name] = vi.fn(self);
  });
  builder.where = vi.fn((condition: SQL | undefined) => {
    recorded.push(
      condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
    );

    return builder;
  });
  builder.limit = vi.fn(self);
  builder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

  return { executor: { select: vi.fn(() => builder) }, recorded };
}

const ROW = {
  orderLineId: 'line-1',
  orderId: 'order-1',
  productId: 'product-1',
  variantId: 'variant-1',
  sellerAccountId: 'seller-1',
  deliveredAt: new Date('2026-08-17T00:00:00.000Z'),
  existingReviewId: null,
};

const REQUIRED_CONDITIONS = [
  {
    label: 'line is the one asked for',
    fragment: `"sals3_order_lines"."id" = `,
  },
  {
    label: 'order belongs to this buyer, compared lower-cased',
    fragment: `lower("sals3_orders"."buyer_email") = `,
  },
  {
    label: "the line's own parcel is delivered",
    fragment: `"fulfillment_groups"."parcel_state" = `,
  },
  { label: 'delivery is inside the review window', fragment: `make_interval` },
];

describe('resolveReviewableLine predicate', () => {
  it.each(REQUIRED_CONDITIONS)(
    'requires that the $label',
    async ({ fragment }) => {
      const { executor, recorded } = recordingExecutor([]);

      await resolveReviewableLine(
        { buyerEmail: 'buyer@example.com', orderLineId: 'line-1' },
        executor as never,
      );

      expect(recorded[0]).toContain(fragment);
    },
  );

  /**
   * `TRACKING_CONFLICT` is a carrier "delivered" the supplier disputes
   * (ADR-004 §5), so its buyer-facing meaning is "we do not know this arrived".
   * Accepting it would invite a review of a parcel that may never have landed.
   */
  it('gates on DELIVERED alone, never on any other parcel state', async () => {
    const { executor, recorded } = recordingExecutor([]);

    await resolveReviewableLine(
      { buyerEmail: 'buyer@example.com', orderLineId: 'line-1' },
      executor as never,
    );

    expect(recorded[0]).toContain(`"parcel_state" = `);
    expect(recorded[0]).not.toContain('TRACKING_CONFLICT');
    expect(recorded[0]).not.toContain('SHIPPED');
    expect(recorded[0]).not.toContain(' in ');
  });
});

describe('resolveReviewableLine outcomes', () => {
  /**
   * Unknown, not-yours, undelivered and out-of-window must be one answer. A
   * buyer who can tell them apart can enumerate other people's order lines by
   * watching which id changes the reply.
   */
  it('answers not_eligible for anything the predicate excluded', async () => {
    const { executor } = recordingExecutor([]);

    await expect(
      resolveReviewableLine(
        { buyerEmail: 'buyer@example.com', orderLineId: 'line-1' },
        executor as never,
      ),
    ).resolves.toEqual({ ok: false, reason: 'not_eligible' });
  });

  it('refuses an empty address without querying at all', async () => {
    const { executor } = recordingExecutor([ROW]);

    await expect(
      resolveReviewableLine(
        { buyerEmail: '   ', orderLineId: 'line-1' },
        executor as never,
      ),
    ).resolves.toEqual({ ok: false, reason: 'not_eligible' });
    expect(executor.select).not.toHaveBeenCalled();
  });

  /** The buyer's own row, so saying so tells them nothing they did not do. */
  it('distinguishes a line this buyer already reviewed', async () => {
    const { executor } = recordingExecutor([
      { ...ROW, existingReviewId: 'review-1' },
    ]);

    await expect(
      resolveReviewableLine(
        { buyerEmail: 'buyer@example.com', orderLineId: 'line-1' },
        executor as never,
      ),
    ).resolves.toEqual({ ok: false, reason: 'already_reviewed' });
  });

  /**
   * The seller comes from the fulfillment group's supplier connection — who
   * actually took the order — not from `products.steward_seller_account_id`.
   */
  it('returns the seller of record and the frozen delivery instant', async () => {
    const { executor } = recordingExecutor([ROW]);

    const outcome = await resolveReviewableLine(
      { buyerEmail: 'Buyer@Example.com', orderLineId: 'line-1' },
      executor as never,
    );

    expect(outcome).toEqual({
      ok: true,
      line: {
        orderLineId: 'line-1',
        orderId: 'order-1',
        productId: 'product-1',
        variantId: 'variant-1',
        sellerAccountId: 'seller-1',
        deliveredAt: ROW.deliveredAt,
      },
    });
  });
});

describe('listLineReviewStates', () => {
  it('scopes to the buyer and never queries for an empty order set', async () => {
    const { executor } = recordingExecutor([]);

    await expect(
      listLineReviewStates(
        { buyerEmail: 'buyer@example.com', orderIds: [] },
        executor as never,
      ),
    ).resolves.toEqual([]);
    expect(executor.select).not.toHaveBeenCalled();
  });

  it('marks a delivered, unreviewed, in-window line reviewable', async () => {
    const { executor } = recordingExecutor([
      {
        orderLineId: 'line-1',
        parcelState: 'DELIVERED',
        withinWindow: true,
        reviewId: null,
        rating: null,
        reviewCreatedAt: null,
      },
    ]);

    await expect(
      listLineReviewStates(
        { buyerEmail: 'buyer@example.com', orderIds: ['order-1'] },
        executor as never,
      ),
    ).resolves.toEqual([
      { orderLineId: 'line-1', reviewable: true, review: null },
    ]);
  });

  it.each([
    ['SHIPPED', 'a package still moving'],
    ['TRACKING_CONFLICT', 'a delivery under dispute'],
    ['DELIVERY_EXCEPTION', 'a delivery that failed'],
  ])('refuses %s (%s)', async (parcelState) => {
    const { executor } = recordingExecutor([
      {
        orderLineId: 'line-1',
        parcelState,
        withinWindow: true,
        reviewId: null,
        rating: null,
        reviewCreatedAt: null,
      },
    ]);

    const [state] = await listLineReviewStates(
      { buyerEmail: 'buyer@example.com', orderIds: ['order-1'] },
      executor as never,
    );

    expect(state?.reviewable).toBe(false);
  });

  /** Delivered and reviewed: not reviewable again, and the review comes back. */
  it('reports an existing review and stops offering the control', async () => {
    const createdAt = new Date('2026-08-19T10:00:00.000Z');
    const { executor } = recordingExecutor([
      {
        orderLineId: 'line-1',
        parcelState: 'DELIVERED',
        withinWindow: true,
        reviewId: 'review-1',
        rating: 5,
        reviewCreatedAt: createdAt,
      },
    ]);

    await expect(
      listLineReviewStates(
        { buyerEmail: 'buyer@example.com', orderIds: ['order-1'] },
        executor as never,
      ),
    ).resolves.toEqual([
      {
        orderLineId: 'line-1',
        reviewable: false,
        review: {
          id: 'review-1',
          rating: 5,
          createdAt: createdAt.toISOString(),
        },
      },
    ]);
  });

  /** Out of window: delivered, unreviewed, and still not offered. */
  it('closes the window', async () => {
    const { executor } = recordingExecutor([
      {
        orderLineId: 'line-1',
        parcelState: 'DELIVERED',
        withinWindow: false,
        reviewId: null,
        rating: null,
        reviewCreatedAt: null,
      },
    ]);

    const [state] = await listLineReviewStates(
      { buyerEmail: 'buyer@example.com', orderIds: ['order-1'] },
      executor as never,
    );

    expect(state?.reviewable).toBe(false);
  });
});
