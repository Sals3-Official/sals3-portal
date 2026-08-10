import {
  INITIAL_PRICE_SPLIT_CENTS,
  MIN_PRICE_INTERVAL_CENTS,
  MIN_TIME_INTERVAL_MS,
} from './config';

/**
 * Pure adaptive partition planning (ADR-010 §12.1, ADR-013 §3). Splitting is
 * driven ONLY by observed density: a partition whose reported total exceeds
 * one full page (200) is bisected by time, then by price, and finally
 * enumerated exhaustively (atomic reconciliation). There is deliberately no
 * result-cap rule of any kind here - a total of exactly 6,000 or greater is
 * ordinary density information, never a completion or failure threshold.
 *
 * Boundary rule: children share their boundary point (inclusive overlap), so
 * the provider's undocumented inclusive/exclusive boundary behavior cannot
 * silently lose a product that sits exactly on a split point - global PID
 * deduplication absorbs the duplicate instead.
 */

export type PartitionBounds = {
  categoryId: string;
  /** Null = open start (the pre-epoch sentinel partition). */
  timeFromMs: number | null;
  timeToMs: number;
  /** USD cents; null = unbounded on that side. */
  priceFromCents: number | null;
  priceToCents: number | null;
};

export type PartitionPlan =
  | { kind: 'SPLIT_TIME'; children: [PartitionBounds, PartitionBounds] }
  | { kind: 'SPLIT_PRICE'; children: [PartitionBounds, PartitionBounds] }
  | { kind: 'ATOMIC_RECONCILE' };

function canSplitTime(bounds: PartitionBounds): boolean {
  if (bounds.timeFromMs === null) return false;

  return bounds.timeToMs - bounds.timeFromMs >= 2 * MIN_TIME_INTERVAL_MS;
}

function splitTime(
  bounds: PartitionBounds,
): [PartitionBounds, PartitionBounds] {
  if (bounds.timeFromMs === null) {
    throw new Error('Cannot time-split an open-start partition.');
  }

  const span = bounds.timeToMs - bounds.timeFromMs;
  // Snap the midpoint to whole provider time resolution so the wire values
  // of parent and children stay exact and re-derivable.
  const midMs =
    bounds.timeFromMs +
    Math.floor(span / 2 / MIN_TIME_INTERVAL_MS) * MIN_TIME_INTERVAL_MS;

  return [
    { ...bounds, timeToMs: midMs },
    { ...bounds, timeFromMs: midMs },
  ];
}

function canSplitPrice(bounds: PartitionBounds): boolean {
  // Unbounded on either side can always be narrowed once.
  if (bounds.priceFromCents === null || bounds.priceToCents === null) {
    return true;
  }

  return (
    bounds.priceToCents - bounds.priceFromCents >= 2 * MIN_PRICE_INTERVAL_CENTS
  );
}

function splitPrice(
  bounds: PartitionBounds,
): [PartitionBounds, PartitionBounds] {
  const from = bounds.priceFromCents;
  const to = bounds.priceToCents;

  if (from === null && to === null) {
    // First narrowing of a fully unbounded price range: a fixed, documented
    // configuration point rather than a guess derived from provider data.
    return [
      { ...bounds, priceFromCents: 0, priceToCents: INITIAL_PRICE_SPLIT_CENTS },
      { ...bounds, priceFromCents: INITIAL_PRICE_SPLIT_CENTS },
    ];
  }

  if (to === null) {
    // Open-top range [from, inf): geometric doubling keeps every child
    // deterministic without assuming a maximum catalogue price.
    const base = from as number;
    const splitPoint = base === 0 ? INITIAL_PRICE_SPLIT_CENTS : base * 2;

    return [
      { ...bounds, priceFromCents: base, priceToCents: splitPoint },
      { ...bounds, priceFromCents: splitPoint },
    ];
  }

  if (from === null) {
    // Open-bottom [0/unbounded, to]: anchor at zero, then bisect.
    const mid = Math.floor(to / 2);

    return [
      { ...bounds, priceFromCents: 0, priceToCents: mid },
      { ...bounds, priceFromCents: mid },
    ];
  }

  const mid = from + Math.floor((to - from) / 2);

  return [
    { ...bounds, priceToCents: mid },
    { ...bounds, priceFromCents: mid },
  ];
}

/**
 * True when a proposed split failed to strictly reduce its parent - a
 * non-progressing split that must be refused (ADR-010 §12.1's infinite-
 * partitioning guard).
 */
function isProgressing(
  parent: PartitionBounds,
  children: [PartitionBounds, PartitionBounds],
): boolean {
  return children.every(
    (child) =>
      child.timeFromMs !== parent.timeFromMs ||
      child.timeToMs !== parent.timeToMs ||
      child.priceFromCents !== parent.priceFromCents ||
      child.priceToCents !== parent.priceToCents,
  );
}

/**
 * Decides how a partition too dense for one page (`reportedTotal > pageSize`)
 * proceeds: bisect by time while the interval is divisible, then by price at
 * provider-supported precision, and at exhaustion transition to atomic
 * reconciliation - explicitly NOT to coverage success.
 */
export default function planDensePartition(
  bounds: PartitionBounds,
): PartitionPlan {
  if (canSplitTime(bounds)) {
    const children = splitTime(bounds);

    if (isProgressing(bounds, children)) {
      return { kind: 'SPLIT_TIME', children };
    }
  }

  if (canSplitPrice(bounds)) {
    const children = splitPrice(bounds);

    if (isProgressing(bounds, children)) {
      return { kind: 'SPLIT_PRICE', children };
    }
  }

  return { kind: 'ATOMIC_RECONCILE' };
}
