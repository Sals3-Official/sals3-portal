import { describe, expect, it } from 'vitest';
import {
  classifyShippingTiers,
  parseArrivalWindow,
  type TierCandidate,
} from './shipping-tiers';

function quote(
  optionId: string,
  amountMinor: number,
  arrivalTime: string,
  channelId = `channel-${optionId}`,
): TierCandidate {
  return { optionId, channelId, amountMinor, arrivalTime };
}

describe('classifyShippingTiers', () => {
  it('reduces many couriers to three distinct ordered tiers', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      quote(
        `option-${index + 1}`,
        (index + 1) * 100,
        `${index + 1}-${40 - index}`,
      ),
    );
    const result = classifyShippingTiers(rows);

    expect(result.map((row) => row.shippingTier)).toEqual([
      'Standard',
      'Express',
      'Expedited',
    ]);
    expect(new Set(result.map((row) => row.optionId)).size).toBe(3);
  });

  it('returns Standard and Expedited for two rows when faster service exists', () => {
    expect(
      classifyShippingTiers([
        quote('cheap', 500, '12-20'),
        quote('fast', 900, '3-7'),
      ]).map((row) => row.shippingTier),
    ).toEqual(['Standard', 'Expedited']);
  });

  it('assigns all three tiers when three rows form a real speed ladder', () => {
    expect(
      classifyShippingTiers([
        quote('standard', 500, '12-20'),
        quote('express', 800, '7-10'),
        quote('expedited', 1_200, '2-4'),
      ]).map((row) => [row.shippingTier, row.optionId]),
    ).toEqual([
      ['Standard', 'standard'],
      ['Express', 'express'],
      ['Expedited', 'expedited'],
    ]);
  });

  it('returns only Standard when one row exists', () => {
    expect(classifyShippingTiers([quote('only', 500, '7-10')])).toMatchObject([
      { shippingTier: 'Standard', optionId: 'only' },
    ]);
  });

  it('does not fabricate faster tiers when cheapest is already fastest', () => {
    expect(
      classifyShippingTiers([
        quote('cheap-fast', 500, '2-4'),
        quote('expensive-slow', 1_500, '7-12'),
      ]).map((row) => row.shippingTier),
    ).toEqual(['Standard']);
  });

  it('returns no tiers when every row is invalid', () => {
    expect(
      classifyShippingTiers([
        quote('zero', 0, '3-5'),
        quote('bad-days', 1_000, ''),
        quote(' ', 1_000, '2-3', 'channel'),
      ]),
    ).toEqual([]);
  });

  it('chooses fastest, not most expensive, for Expedited', () => {
    const result = classifyShippingTiers([
      quote('standard', 500, '12-20'),
      quote('fast', 900, '2-4'),
      quote('expensive-slow', 5_000, '5-10'),
    ]);

    expect(
      result.find((row) => row.shippingTier === 'Expedited')?.optionId,
    ).toBe('fast');
  });

  it('uses combined midpoint ranks for Express', () => {
    const result = classifyShippingTiers([
      quote('standard', 500, '12-20'),
      quote('cheap-slow', 600, '8-15'),
      quote('balanced', 900, '6-10'),
      quote('pricey-fast', 1_500, '4-8'),
      quote('expedited', 2_000, '2-4'),
    ]);

    expect(result.find((row) => row.shippingTier === 'Express')?.optionId).toBe(
      'balanced',
    );
  });

  it('excludes invalid rows and conflicting duplicate identities', () => {
    const result = classifyShippingTiers([
      quote('standard', 500, '12-20'),
      quote('duplicate', 700, '7-10', 'same-channel'),
      quote('duplicate', 800, '5-8', 'same-channel'),
      quote('zero', 0, '3-5'),
      quote('bad-days', 1_000, 'soon'),
      quote('', 1_000, '2-3'),
    ]);

    expect(result).toMatchObject([
      { shippingTier: 'Standard', optionId: 'standard' },
    ]);
  });

  it('uses stable price and speed tie-breakers', () => {
    const result = classifyShippingTiers([
      quote('standard-slower', 500, '12-20'),
      quote('standard-faster', 500, '10-15'),
      quote('fast-expensive', 1_500, '3-5'),
      quote('fast-cheaper', 1_000, '3-5'),
    ]);

    expect(
      result.find((row) => row.shippingTier === 'Standard')?.optionId,
    ).toBe('standard-faster');
    expect(
      result.find((row) => row.shippingTier === 'Expedited')?.optionId,
    ).toBe('fast-cheaper');
  });
});

describe('parseArrivalWindow', () => {
  it('accepts ranges, one-day promises, en dashes, and optional days copy', () => {
    expect(parseArrivalWindow('12-20')).toEqual({ minDays: 12, maxDays: 20 });
    expect(parseArrivalWindow('5 days')).toEqual({ minDays: 5, maxDays: 5 });
    expect(parseArrivalWindow('3–7 days')).toEqual({ minDays: 3, maxDays: 7 });
  });

  it('rejects missing, reversed, and non-positive windows', () => {
    expect(parseArrivalWindow('')).toBeNull();
    expect(parseArrivalWindow('soon')).toBeNull();
    expect(parseArrivalWindow('7-3')).toBeNull();
    expect(parseArrivalWindow('0-2')).toBeNull();
  });
});
