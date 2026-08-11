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

/** A signed buffer within the sanity bound above. */
export function isValidFxAdjustmentRate(rateScaled: bigint): boolean {
  return (
    rateScaled >= -MAX_FX_ADJUSTMENT_MAGNITUDE &&
    rateScaled <= MAX_FX_ADJUSTMENT_MAGNITUDE
  );
}

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
 */
export function suggestedPriceMinor(
  effectiveCostMinor: bigint,
  marginRateScaled: bigint,
): bigint {
  if (!isValidMarginRate(marginRateScaled)) {
    throw new RangeError('target margin rate must satisfy 0 < rate < 1');
  }

  const denominatorScaled = RATE_SCALE - marginRateScaled;

  return roundHalfUpDiv(effectiveCostMinor * RATE_SCALE, denominatorScaled);
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
