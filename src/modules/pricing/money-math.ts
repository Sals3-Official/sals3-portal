/**
 * Decimal-safe rate/money arithmetic for the pricing resolver.
 *
 * Everything here is BigInt fixed-point math — no `Decimal`/`decimal.js`
 * dependency, matching this codebase's existing house convention of plain
 * integer minor-unit money (see `src/lib/seller-center/product-editor/types.ts`'s
 * `MoneyValue`) and its stated preference for the simplest reliable
 * implementation. A rate is stored in Postgres as `numeric` (Drizzle reads
 * it back as a `string`, never a JS `number`) and is parsed here into a
 * `bigint` scaled by `RATE_SCALE` so no floating-point value is ever the
 * source of truth for a number used to price a real product.
 *
 * BigInt values are built with `BigInt(...)` rather than the `123n` literal
 * suffix throughout this file: the project's `tsconfig.json` targets
 * `ES2017`, and TypeScript rejects bigint literal syntax below `ES2020`
 * regardless of `lib` — bumping the project-wide compile target is out of
 * scope for this module.
 */

/** 6 decimal places, matching the `numeric(8, 6)` columns this feeds. */
export const RATE_SCALE = BigInt(1_000_000);

/** Sanity bound on a seller's FX adjustment, not a business rule — guards against fat-finger entry (e.g. `2.5` typed instead of `0.025`). */
export const MAX_FX_ADJUSTMENT_MAGNITUDE = RATE_SCALE / BigInt(5); // ±20%

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Parses a decimal string (e.g. `"0.125"`) into a `RATE_SCALE`-scaled bigint. Throws on malformed input or more than 6 decimal places. */
export function parseScaledRate(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value.trim());

  if (match === null) {
    throw new RangeError(`Not a valid decimal rate: "${value}"`);
  }

  const [, sign, intPart, fracPart = ''] = match;

  if (fracPart.length > 6) {
    throw new RangeError(`More than 6 decimal places: "${value}"`);
  }

  const paddedFrac = fracPart.padEnd(6, '0');
  const magnitude = BigInt(intPart) * RATE_SCALE + BigInt(paddedFrac);

  return sign === '-' ? -magnitude : magnitude;
}

/** Inverse of `parseScaledRate` — for writing a computed/validated rate back to a `numeric` column. */
export function formatScaledRate(rateScaled: bigint): string {
  const negative = rateScaled < BigInt(0);
  const magnitude = negative ? -rateScaled : rateScaled;
  const intPart = magnitude / RATE_SCALE;
  const fracPart = (magnitude % RATE_SCALE).toString().padStart(6, '0');

  return `${negative ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

/** `0 < rate < 1`, matching ADR-003/ADR-015's "margin is a rate" rule. */
export function isValidMarginRate(rateScaled: bigint): boolean {
  return rateScaled > BigInt(0) && rateScaled < RATE_SCALE;
}

/**
 * `0 <= rate < 1` — the bound a TARGET margin must satisfy.
 *
 * Deliberately one notch wider than `isValidMarginRate`, and only for the
 * target: a target of exactly 0 is a real rule a seller can mean ("sell this
 * category at cost"), and `price = cost / (1 - 0)` prices it correctly. A
 * *floor* of 0 means nothing — it is a typo — so the floor keeps the strict
 * bound and the two are not interchangeable. Owner decision 2026-08-28.
 */
export function isValidTargetMarginRate(rateScaled: bigint): boolean {
  return rateScaled >= BigInt(0) && rateScaled < RATE_SCALE;
}

/**
 * The widest markup a bulk import may carry, in percent: `500` sells at six
 * times cost. A sanity bound, not a business rule — it is the fat-finger
 * guard `margin_percent`'s old `< 100` used to provide.
 */
export const MAX_MARKUP_PERCENT = 500;

/** Round-half-up integer division. Both operands must be non-negative/positive respectively — every call site in this module guarantees that by construction. */
function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= BigInt(0)) {
    throw new RangeError('denominator must be positive');
  }
  if (numerator < BigInt(0)) {
    throw new RangeError('numerator must not be negative');
  }

  return (numerator + denominator / BigInt(2)) / denominator;
}

/**
 * Markup percent -> the margin rate this codebase stores.
 *
 * The two are different numbers for the same price and confusing them is a
 * mispricing, so the conversion lives here rather than at a call site:
 * markup is measured against COST (`300` = sell at four times cost), margin
 * against the SELLING PRICE, and `margin = markup / (100 + markup)` is the
 * identity that makes `price = cost / (1 - margin)` land on `cost * 4`.
 *
 * Fixed-point throughout: the percent is scaled to a bigint before any
 * division, so no float ever reaches a stored rate. `300` converts to exactly
 * `0.750000`; a percent that does not divide evenly rounds half-up at the
 * sixth decimal place, which is all a `numeric(8, 6)` column can hold anyway.
 */
export function markupPercentToMarginRateScaled(markupPercent: number): bigint {
  if (!Number.isFinite(markupPercent) || markupPercent < 0) {
    throw new RangeError('markup percent must be zero or more');
  }

  const markupScaled = BigInt(Math.round(markupPercent * Number(RATE_SCALE)));
  const denominator = BigInt(100) * RATE_SCALE + markupScaled;

  return roundHalfUpDiv(markupScaled * RATE_SCALE, denominator);
}

/**
 * Inverse of `markupPercentToMarginRateScaled`, to two decimal places — what
 * an export writes back into the file a seller edits.
 *
 * Two decimals because the file is a spreadsheet a person reads, and because
 * a round trip has to be stable: `300` exports as `300`, and a rate that came
 * from `35` exports as `35` rather than `34.999999`.
 */
export function markupPercentFromMarginRateScaled(rateScaled: bigint): number {
  if (!isValidTargetMarginRate(rateScaled)) {
    throw new RangeError('margin rate must satisfy 0 <= rate < 1');
  }

  const hundredths = roundHalfUpDiv(
    rateScaled * BigInt(10_000),
    RATE_SCALE - rateScaled,
  );

  return Number(hundredths) / 100;
}

/** A signed buffer within the sanity bound above. */
export function isValidFxAdjustmentRate(rateScaled: bigint): boolean {
  return (
    rateScaled >= -MAX_FX_ADJUSTMENT_MAGNITUDE &&
    rateScaled <= MAX_FX_ADJUSTMENT_MAGNITUDE
  );
}

/** Converts a minor-unit amount using a `RATE_SCALE`-scaled rate. */
export function convertAmountMinor(
  amountMinor: number,
  rateScaled: bigint,
): bigint {
  if (rateScaled <= BigInt(0)) {
    throw new RangeError('conversion rate must be positive');
  }

  return roundHalfUpDiv(
    BigInt(Math.trunc(amountMinor)) * rateScaled,
    RATE_SCALE,
  );
}

/**
 * Applies a seller FX adjustment (signed buffer) on top of a reference
 * rate: `effectiveRate = referenceRate * (1 + adjustment)`. Kept as its own
 * function so "reference rate" and "adjustment" are never silently merged
 * into one number before this point (ADR-015 §4).
 */
export function applyFxAdjustment(
  referenceRateScaled: bigint,
  adjustmentRateScaled: bigint,
): bigint {
  const multiplier = RATE_SCALE + adjustmentRateScaled;

  if (multiplier <= BigInt(0)) {
    throw new RangeError('adjusted rate must stay positive');
  }

  return roundHalfUpDiv(referenceRateScaled * multiplier, RATE_SCALE);
}

/**
 * `price = cost / (1 - targetMarginRate)`, matching ADR-003 §4 /
 * `part31`'s formula. Throws rather than returning a nonsensical price for
 * an out-of-range rate — the resolver must catch this before it can ever
 * fire (defense in depth: the same bound is validated at every write
 * boundary too).
 *
 * A rate of exactly 0 is allowed and prices at cost; only `>= 1`, where the
 * denominator vanishes or turns negative, is refused.
 */
export function suggestedPriceMinor(
  effectiveCostMinor: bigint,
  marginRateScaled: bigint,
): bigint {
  if (!isValidTargetMarginRate(marginRateScaled)) {
    throw new RangeError('target margin rate must satisfy 0 <= rate < 1');
  }

  const denominatorScaled = RATE_SCALE - marginRateScaled;

  return roundHalfUpDiv(effectiveCostMinor * RATE_SCALE, denominatorScaled);
}

/**
 * ADR-015 §1's "minimum contribution profit": the suggested price is
 * `max(marginPrice, cost + floor)`. A percentage margin scales with cost,
 * so on a cheap item it can suggest a price whose absolute contribution
 * cannot cover fixed per-order costs; the floor is the absolute backstop.
 * Returns the winning amount — the caller compares against the input to
 * know whether the floor fired.
 */
/**
 * The floor a minimum-margin rule puts under a price.
 *
 * `price = cost / (1 - rate)` — deliberately the same formula
 * `computeSuggestedPriceMinor` uses for the target margin, so the two numbers
 * mean the same thing and can be compared directly. A floor of 0.18 therefore
 * reads as "never below an 18% margin", not "18% on top of cost"; those differ
 * by more than they look (1.2195x against 1.18x), and picking the other one
 * would make a floor that reads higher than a margin quietly sit below it.
 *
 * Throws on a rate outside the open interval rather than returning a nonsense
 * price. `pricing_store_defaults_floor_rate_range` refuses those rows, so this
 * is defence in depth against a row that predates the constraint.
 */
export function marginFloorMinor(
  effectiveCostMinor: bigint,
  floorRateScaled: bigint,
): bigint {
  return suggestedPriceMinor(effectiveCostMinor, floorRateScaled);
}

export function applyContributionFloor(
  suggestedMinor: bigint,
  effectiveCostMinor: bigint,
  minContributionMinor: bigint,
): bigint {
  if (minContributionMinor < BigInt(0)) {
    throw new RangeError('minimum contribution must not be negative');
  }

  const floorMinor = effectiveCostMinor + minContributionMinor;

  return suggestedMinor >= floorMinor ? suggestedMinor : floorMinor;
}

export type RoundingRule = 'NONE' | 'NEAREST_0_99';

/**
 * `NEAREST_0_99` rounds UP to the current major-unit bucket's `.99` — e.g.
 * 13.00 -> 13.99, 12.99 -> 12.99 (unchanged), 13.01 -> 13.99. It never
 * rounds down, so it can never quote below the computed suggested price
 * (which would silently erode the resolved margin) — this is charm
 * pricing, not a fabricated "was" price; ADR-003 §5 bans the latter, not
 * the former.
 */
export function applyRounding(
  amountMinor: bigint,
  rule: RoundingRule,
  minorUnitsPerMajor: bigint = BigInt(100),
): bigint {
  if (rule === 'NONE') return amountMinor;

  const major = amountMinor / minorUnitsPerMajor;

  return major * minorUnitsPerMajor + (minorUnitsPerMajor - BigInt(1));
}
