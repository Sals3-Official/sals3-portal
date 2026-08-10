import { describe, expect, it } from 'vitest';
import planDensePartition, { type PartitionBounds } from './partition-plan';
import {
  INITIAL_PRICE_SPLIT_CENTS,
  MIN_PRICE_INTERVAL_CENTS,
  MIN_TIME_INTERVAL_MS,
} from './config';

const HOUR_MS = 60 * 60 * 1000;

function bounds(overrides: Partial<PartitionBounds> = {}): PartitionBounds {
  return {
    categoryId: 'cat-1',
    timeFromMs: 1_600_000_000_000,
    timeToMs: 1_600_000_000_000 + 24 * HOUR_MS,
    priceFromCents: null,
    priceToCents: null,
    ...overrides,
  };
}

describe('planDensePartition - adaptive time splitting', () => {
  it('bisects a divisible time range with an inclusive shared boundary', () => {
    const parent = bounds();
    const plan = planDensePartition(parent);

    expect(plan.kind).toBe('SPLIT_TIME');
    if (plan.kind !== 'SPLIT_TIME') return;

    const [left, right] = plan.children;
    // The children share their boundary point exactly - inclusive overlap,
    // so an ambiguous provider boundary cannot silently lose a product.
    expect(left.timeToMs).toBe(right.timeFromMs);
    expect(left.timeFromMs).toBe(parent.timeFromMs);
    expect(right.timeToMs).toBe(parent.timeToMs);
    // Midpoint is snapped to whole provider time resolution.
    expect(
      (left.timeToMs - (parent.timeFromMs as number)) % MIN_TIME_INTERVAL_MS,
    ).toBe(0);
  });

  it('treats a reported total of exactly 6,000 as ordinary density - a plain split, never a special rule', () => {
    // The planner does not even receive the total: density routing happens
    // upstream (total > pageSize). This asserts the plan for a partition
    // that reported 6,000 (or 60,000) is structurally identical to any
    // other dense partition - no cap constant, no error, no halt state.
    const plan = planDensePartition(bounds());

    expect(plan.kind).toBe('SPLIT_TIME');
  });

  it('refuses to time-split below the minimum provider-supported interval and moves to price', () => {
    const from = 1_600_000_000_000;
    const plan = planDensePartition(
      bounds({ timeFromMs: from, timeToMs: from + MIN_TIME_INTERVAL_MS }),
    );

    expect(plan.kind).toBe('SPLIT_PRICE');
  });
});

describe('planDensePartition - minimum-time price splitting', () => {
  const atMinTime = (price: Partial<PartitionBounds>) =>
    bounds({
      timeFromMs: 1_600_000_000_000,
      timeToMs: 1_600_000_000_000 + MIN_TIME_INTERVAL_MS,
      ...price,
    });

  it('first narrows an unbounded price range at the configured initial split point', () => {
    const plan = planDensePartition(atMinTime({}));

    expect(plan.kind).toBe('SPLIT_PRICE');
    if (plan.kind !== 'SPLIT_PRICE') return;

    const [low, high] = plan.children;
    expect(low.priceFromCents).toBe(0);
    expect(low.priceToCents).toBe(INITIAL_PRICE_SPLIT_CENTS);
    expect(high.priceFromCents).toBe(INITIAL_PRICE_SPLIT_CENTS);
    expect(high.priceToCents).toBeNull();
  });

  it('doubles the boundary for an open-top price range', () => {
    const plan = planDensePartition(
      atMinTime({ priceFromCents: 4_000, priceToCents: null }),
    );

    expect(plan.kind).toBe('SPLIT_PRICE');
    if (plan.kind !== 'SPLIT_PRICE') return;

    const [low, high] = plan.children;
    expect(low.priceFromCents).toBe(4_000);
    expect(low.priceToCents).toBe(8_000);
    expect(high.priceFromCents).toBe(8_000);
    expect(high.priceToCents).toBeNull();
  });

  it('bisects a bounded price range with an inclusive shared boundary', () => {
    const plan = planDensePartition(
      atMinTime({ priceFromCents: 1_000, priceToCents: 2_000 }),
    );

    expect(plan.kind).toBe('SPLIT_PRICE');
    if (plan.kind !== 'SPLIT_PRICE') return;

    const [low, high] = plan.children;
    expect(low.priceToCents).toBe(high.priceFromCents);
    expect(low.priceFromCents).toBe(1_000);
    expect(high.priceToCents).toBe(2_000);
  });

  it('refuses a non-progressing price split at provider precision and transitions to atomic reconciliation - never to coverage success', () => {
    const plan = planDensePartition(
      atMinTime({
        priceFromCents: 1_000,
        priceToCents: 1_000 + MIN_PRICE_INTERVAL_CENTS,
      }),
    );

    expect(plan.kind).toBe('ATOMIC_RECONCILE');
  });
});

describe('planDensePartition - open-start sentinel', () => {
  it('sends a dense open-start partition straight to atomic reconciliation once price is exhausted', () => {
    const plan = planDensePartition(
      bounds({
        timeFromMs: null,
        timeToMs: 1_600_000_000_000,
        priceFromCents: 500,
        priceToCents: 500 + MIN_PRICE_INTERVAL_CENTS,
      }),
    );

    expect(plan.kind).toBe('ATOMIC_RECONCILE');
  });

  it('still price-splits a dense open-start partition before giving up on splitting', () => {
    const plan = planDensePartition(
      bounds({ timeFromMs: null, timeToMs: 1_600_000_000_000 }),
    );

    expect(plan.kind).toBe('SPLIT_PRICE');
  });
});
