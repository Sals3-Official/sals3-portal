export const SHIPPING_TIERS = ['Standard', 'Express', 'Expedited'] as const;

export type ShippingTier = (typeof SHIPPING_TIERS)[number];

export function isShippingTier(value: unknown): value is ShippingTier {
  return SHIPPING_TIERS.some((tier) => tier === value);
}

export type TierCandidate = {
  optionId: string;
  channelId: string;
  arrivalTime: string;
  amountMinor: number;
};

type DeliveryWindow = {
  minDays: number;
  maxDays: number;
};

type UsableCandidate<T extends TierCandidate> = {
  quote: T;
  window: DeliveryWindow;
  identity: string;
};

export type TieredCandidate<T extends TierCandidate> = T & {
  shippingTier: ShippingTier;
};

const ARRIVAL_WINDOW_PATTERN =
  /^\s*(\d{1,3})(?:\s*[-\u2013]\s*(\d{1,3}))?\s*(?:days?)?\s*$/i;

export function parseArrivalWindow(value: string): DeliveryWindow | null {
  const match = ARRIVAL_WINDOW_PATTERN.exec(value);

  if (match === null) return null;

  const minDays = Number(match[1]);
  const maxDays = Number(match[2] ?? match[1]);

  if (minDays <= 0 || maxDays < minDays) return null;

  return { minDays, maxDays };
}

function identityOf(quote: TierCandidate): string {
  return `${quote.optionId}\u0000${quote.channelId}`;
}

function stableIdentityCompare(
  left: UsableCandidate<TierCandidate>,
  right: UsableCandidate<TierCandidate>,
): number {
  return left.identity.localeCompare(right.identity);
}

function speedCompare(
  left: UsableCandidate<TierCandidate>,
  right: UsableCandidate<TierCandidate>,
): number {
  return (
    left.window.maxDays - right.window.maxDays ||
    left.window.minDays - right.window.minDays ||
    left.quote.amountMinor - right.quote.amountMinor ||
    stableIdentityCompare(left, right)
  );
}

function priceCompare(
  left: UsableCandidate<TierCandidate>,
  right: UsableCandidate<TierCandidate>,
): number {
  return (
    left.quote.amountMinor - right.quote.amountMinor ||
    left.window.maxDays - right.window.maxDays ||
    left.window.minDays - right.window.minDays ||
    stableIdentityCompare(left, right)
  );
}

function isStrictlyFaster(
  left: UsableCandidate<TierCandidate>,
  right: UsableCandidate<TierCandidate>,
): boolean {
  return (
    left.window.maxDays < right.window.maxDays ||
    (left.window.maxDays === right.window.maxDays &&
      left.window.minDays < right.window.minDays)
  );
}

function consistentCandidates<T extends TierCandidate>(
  quotes: readonly T[],
): Array<UsableCandidate<T>> {
  const byIdentity = quotes.reduce<Map<string, T[]>>((groups, quote) => {
    if (
      quote.optionId.trim() === '' ||
      quote.channelId.trim() === '' ||
      !Number.isInteger(quote.amountMinor) ||
      quote.amountMinor <= 0
    ) {
      return groups;
    }

    const identity = identityOf(quote);
    const group = groups.get(identity);

    if (group === undefined) groups.set(identity, [quote]);
    else group.push(quote);

    return groups;
  }, new Map());

  return Array.from(byIdentity.entries()).flatMap(([identity, group]) => {
    const first = group[0];

    if (first === undefined) return [];

    const signatures = new Set(
      group.map(
        (quote) => `${quote.amountMinor}\u0000${quote.arrivalTime.trim()}`,
      ),
    );
    const window = parseArrivalWindow(first.arrivalTime);

    if (signatures.size !== 1 || window === null) return [];

    return [{ quote: first, window, identity }];
  });
}

function normalizedRank(index: number, count: number): number {
  return count === 1 ? 0.5 : index / (count - 1);
}

function chooseExpress<T extends TierCandidate>(
  candidates: Array<UsableCandidate<T>>,
): UsableCandidate<T> | undefined {
  if (candidates.length === 0) return undefined;

  const byPrice = [...candidates].sort(priceCompare);
  const bySpeed = [...candidates].sort(speedCompare);
  const priceRank = new Map(
    byPrice.map((candidate, index) => [
      candidate.identity,
      normalizedRank(index, byPrice.length),
    ]),
  );
  const speedRank = new Map(
    bySpeed.map((candidate, index) => [
      candidate.identity,
      normalizedRank(index, bySpeed.length),
    ]),
  );

  return [...candidates].sort((left, right) => {
    const leftScore =
      Math.abs((priceRank.get(left.identity) ?? 0.5) - 0.5) +
      Math.abs((speedRank.get(left.identity) ?? 0.5) - 0.5);
    const rightScore =
      Math.abs((priceRank.get(right.identity) ?? 0.5) - 0.5) +
      Math.abs((speedRank.get(right.identity) ?? 0.5) - 0.5);

    return (
      leftScore - rightScore ||
      left.quote.amountMinor - right.quote.amountMinor ||
      speedCompare(left, right)
    );
  })[0];
}

/**
 * Turns CJ courier rows into distinct Sals3 delivery promises.
 * Missing promises stay missing; storefront owns fixed three-card rendering.
 */
export function classifyShippingTiers<T extends TierCandidate>(
  quotes: readonly T[],
): Array<TieredCandidate<T>> {
  const candidates = consistentCandidates(quotes);
  const standard = [...candidates].sort(priceCompare)[0];

  if (standard === undefined) return [];

  const expedited = candidates
    .filter(
      (candidate) =>
        candidate.identity !== standard.identity &&
        isStrictlyFaster(candidate, standard),
    )
    .sort(speedCompare)[0];
  const express =
    expedited === undefined
      ? undefined
      : chooseExpress(
          candidates.filter(
            (candidate) =>
              candidate.identity !== standard.identity &&
              candidate.identity !== expedited.identity &&
              isStrictlyFaster(candidate, standard) &&
              isStrictlyFaster(expedited, candidate),
          ),
        );
  const byTier: Array<readonly [ShippingTier, UsableCandidate<T> | undefined]> =
    [
      ['Standard', standard],
      ['Express', express],
      ['Expedited', expedited],
    ];

  return byTier.flatMap(([shippingTier, candidate]) =>
    candidate === undefined ? [] : [{ ...candidate.quote, shippingTier }],
  );
}
