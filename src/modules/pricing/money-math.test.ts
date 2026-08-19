import { describe, expect, it } from 'vitest';
import {
  applyContributionFloor,
  applyFxAdjustment,
  applyRounding,
  convertAmountMinor,
  formatScaledRate,
  isValidFxAdjustmentRate,
  isValidMarginRate,
  parseScaledRate,
  RATE_SCALE,
  suggestedPriceMinor,
} from './money-math';

// BigInt values are built with `BigInt(...)` rather than the `123n` literal
// suffix — see money-math.ts's header comment (project targets ES2017).
const b = (n: number | string) => BigInt(n);

describe('parseScaledRate / formatScaledRate', () => {
  it('round-trips a decimal rate exactly', () => {
    expect(parseScaledRate('0.125')).toBe(b(125_000));
    expect(formatScaledRate(b(125_000))).toBe('0.125000');
  });

  it('round-trips a negative rate', () => {
    expect(parseScaledRate('-0.025')).toBe(b(-25_000));
    expect(formatScaledRate(b(-25_000))).toBe('-0.025000');
  });

  it('accepts a whole number', () => {
    expect(parseScaledRate('1')).toBe(RATE_SCALE);
  });

  it('rejects more than 6 decimal places', () => {
    expect(() => parseScaledRate('0.1234567')).toThrow(RangeError);
  });

  it('rejects a non-numeric string', () => {
    expect(() => parseScaledRate('abc')).toThrow(RangeError);
    expect(() => parseScaledRate('1e5')).toThrow(RangeError);
  });
});

describe('isValidMarginRate', () => {
  it('accepts a rate strictly between 0 and 1', () => {
    expect(isValidMarginRate(parseScaledRate('0.3'))).toBe(true);
  });

  it('rejects 0, 1, and anything outside (0, 1)', () => {
    expect(isValidMarginRate(b(0))).toBe(false);
    expect(isValidMarginRate(RATE_SCALE)).toBe(false);
    expect(isValidMarginRate(-parseScaledRate('0.1'))).toBe(false);
    expect(isValidMarginRate(parseScaledRate('1.5'))).toBe(false);
  });
});

describe('isValidFxAdjustmentRate', () => {
  it('accepts a rate within ±20%', () => {
    expect(isValidFxAdjustmentRate(parseScaledRate('0.19'))).toBe(true);
    expect(isValidFxAdjustmentRate(parseScaledRate('-0.19'))).toBe(true);
  });

  it('rejects a rate outside the sanity bound', () => {
    expect(isValidFxAdjustmentRate(parseScaledRate('0.21'))).toBe(false);
    expect(isValidFxAdjustmentRate(parseScaledRate('-0.21'))).toBe(false);
  });
});

describe('convertAmountMinor', () => {
  it('converts using an identity rate unchanged', () => {
    expect(convertAmountMinor(1999, RATE_SCALE)).toBe(b(1999));
  });

  it('rounds half up', () => {
    // 1000 * 1.005 = 1005.0 exactly
    expect(convertAmountMinor(1000, parseScaledRate('1.005'))).toBe(b(1005));
    // 999 * 1.0005 = 999.4995 -> rounds to 999
    expect(convertAmountMinor(999, parseScaledRate('1.0005'))).toBe(b(999));
  });

  it('rejects a non-positive rate', () => {
    expect(() => convertAmountMinor(1000, b(0))).toThrow(RangeError);
    expect(() => convertAmountMinor(1000, -RATE_SCALE)).toThrow(RangeError);
  });
});

describe('applyFxAdjustment', () => {
  it('applies a positive buffer on top of the reference rate', () => {
    // reference 1.0, +2.5% adjustment -> 1.025
    const effective = applyFxAdjustment(RATE_SCALE, parseScaledRate('0.025'));
    expect(formatScaledRate(effective)).toBe('1.025000');
  });

  it('applies a negative buffer', () => {
    const effective = applyFxAdjustment(RATE_SCALE, parseScaledRate('-0.025'));
    expect(formatScaledRate(effective)).toBe('0.975000');
  });

  it('rejects an adjustment that would flip the effective rate non-positive', () => {
    expect(() =>
      applyFxAdjustment(RATE_SCALE, parseScaledRate('-1.5')),
    ).toThrow(RangeError);
  });
});

describe('suggestedPriceMinor', () => {
  it('computes cost / (1 - margin)', () => {
    // cost 1000, margin 0.20 -> 1000 / 0.8 = 1250
    expect(suggestedPriceMinor(b(1000), parseScaledRate('0.2'))).toBe(b(1250));
  });

  it('rounds half up on a non-exact division', () => {
    // cost 1000, margin 0.30 -> 1000 / 0.7 = 1428.571... -> 1429
    expect(suggestedPriceMinor(b(1000), parseScaledRate('0.3'))).toBe(b(1429));
  });

  it('never divides by zero or produces a negative price for an in-range margin approaching 1', () => {
    const result = suggestedPriceMinor(b(1000), parseScaledRate('0.999999'));
    expect(result).toBeGreaterThan(b(0));
    expect(Number.isFinite(Number(result))).toBe(true);
  });

  it('rejects margin rate of exactly 0 (still an invalid rate, not just a no-op)', () => {
    expect(() => suggestedPriceMinor(b(1000), b(0))).toThrow(RangeError);
  });

  it('rejects margin rate of exactly 1 (division by zero)', () => {
    expect(() => suggestedPriceMinor(b(1000), RATE_SCALE)).toThrow(RangeError);
  });

  it('rejects a margin rate above 1 (would produce a negative price)', () => {
    expect(() => suggestedPriceMinor(b(1000), parseScaledRate('1.5'))).toThrow(
      RangeError,
    );
  });

  it('rejects a negative margin rate', () => {
    expect(() => suggestedPriceMinor(b(1000), -parseScaledRate('0.1'))).toThrow(
      RangeError,
    );
  });
});

describe('applyRounding', () => {
  it('NONE is a no-op', () => {
    expect(applyRounding(b(1250), 'NONE')).toBe(b(1250));
  });

  it('NEAREST_0_99 rounds up to the current bucket charm price', () => {
    expect(applyRounding(b(1300), 'NEAREST_0_99')).toBe(b(1399)); // 13.00 -> 13.99
    expect(applyRounding(b(1301), 'NEAREST_0_99')).toBe(b(1399)); // 13.01 -> 13.99
  });

  it('NEAREST_0_99 leaves an already-charm price unchanged', () => {
    expect(applyRounding(b(1299), 'NEAREST_0_99')).toBe(b(1299)); // 12.99 -> 12.99
  });

  it('NEAREST_0_99 never rounds down below the input, protecting the resolved margin', () => {
    [0, 1, 99, 100, 101, 1299, 1300, 999_999].forEach((amount) => {
      expect(applyRounding(b(amount), 'NEAREST_0_99')).toBeGreaterThanOrEqual(
        b(amount),
      );
    });
  });
});

describe('applyContributionFloor', () => {
  it('returns the percentage price when it already clears cost + floor', () => {
    expect(applyContributionFloor(b(1250), b(1000), b(100))).toBe(b(1250));
  });

  it('lifts to cost + floor when the percentage price falls short', () => {
    expect(applyContributionFloor(b(1250), b(1000), b(500))).toBe(b(1500));
  });

  it('a zero floor is an exact no-op', () => {
    expect(applyContributionFloor(b(1250), b(1000), b(0))).toBe(b(1250));
  });

  it('the exact crossover point goes to the percentage price (>=, not >)', () => {
    // suggested == cost + floor: nothing to lift.
    expect(applyContributionFloor(b(1500), b(1000), b(500))).toBe(b(1500));
  });

  it('rejects a negative floor instead of silently discounting below cost', () => {
    expect(() => applyContributionFloor(b(1250), b(1000), b(-1))).toThrow(
      RangeError,
    );
  });
});
