import { describe, expect, it } from 'vitest';
import {
  combinationKeyOf,
  deriveOptionSplit,
  splitLabelTokens,
  type LabelledVariant,
} from './option-split';

function variant(variantId: string, label: string | null): LabelledVariant {
  return { variantId, label };
}

/**
 * The real corduroy jacket, read off the live add-product screen on 2026-08-14:
 * two colours by five sizes, ten variants, no gaps.
 */
const REAL = [
  'Black-S',
  'Black-M',
  'Black-L',
  'Black-XL',
  'Black-XXL',
  'Army Green-S',
  'Army Green-M',
  'Army Green-L',
  'Army Green-XL',
  'Army Green-XXL',
].map((label, index) => variant(`v${index}`, label));

describe('deriveOptionSplit', () => {
  it('recovers the real 2 x 5 grid from production labels', () => {
    const result = deriveOptionSplit(REAL);

    // Splitting on CJ's hyphen keeps "Army Green" whole. A space-delimited split
    // would have broken the colour in half.
    expect(result?.positions).toEqual([
      { index: 0, values: ['Black', 'Army Green'] },
      { index: 1, values: ['S', 'M', 'L', 'XL', 'XXL'] },
    ]);
    expect(result?.byCombination.get('Army Green-XL')).toBe('v8');
  });

  it('proposes positions, never names', () => {
    const result = deriveOptionSplit(REAL);

    // The guarantee that keeps this inside the never-split rule: positions carry
    // an index and values, nothing else. A name would have to be invented, and it
    // would reach a buyer as a product attribute.
    expect(JSON.stringify(result?.positions)).not.toMatch(/colou?r|size|name/i);
  });

  it('refuses an incomplete cross-product rather than inferring the gaps', () => {
    // Black-1XL and Red-2XL imply four combinations but only two exist. The
    // missing Black-2XL and Red-1XL are unknowable.
    expect(
      deriveOptionSplit([variant('a', 'Black-1XL'), variant('b', 'Red-2XL')]),
    ).toBe(undefined);
  });

  it('refuses a ragged token count', () => {
    expect(
      deriveOptionSplit([
        variant('a', 'Black-S'),
        variant('b', 'Black-S-Cotton'),
        variant('c', 'Red-S'),
        variant('d', 'Red-M'),
      ]),
    ).toBe(undefined);
  });

  it('refuses when any label is missing', () => {
    expect(
      deriveOptionSplit([
        variant('a', 'Black-S'),
        variant('b', null),
        variant('c', 'Red-S'),
        variant('d', 'Red-M'),
      ]),
    ).toBe(undefined);
  });

  it('refuses a single-token label such as CJ’s "default"', () => {
    expect(
      deriveOptionSplit([variant('a', 'default'), variant('b', 'other')]),
    ).toBe(undefined);
  });

  /**
   * The Winter Khaki Jacket, live on 2026-08-15: one colour, five sizes. Two
   * live products (this shape) and two more (six colours, one size) were
   * refused entirely under the old rule, which treated a constant position as
   * disqualifying the whole label rather than as one axis to drop.
   */
  it('drops a position that never varies and derives the one that does', () => {
    const split = deriveOptionSplit([
      variant('a', 'Khaki-M'),
      variant('b', 'Khaki-S'),
      variant('c', 'Khaki-L'),
    ]);

    expect(split).not.toBe(undefined);
    // Only the varying position is offered - "Khaki" is never proposed as a
    // one-choice axis, and `index` is the position in the supplier's own
    // label (1), not the position in the returned array (0).
    expect(split?.positions).toEqual([{ index: 1, values: ['M', 'S', 'L'] }]);
    // The combination key still carries the constant token: it is derived
    // from the full label, and the constant's presence in every key does not
    // stop the key from being unique per variant.
    expect(split?.byCombination.get('Khaki-M')).toBe('a');
  });

  /**
   * The Landlord Hat, live on 2026-08-15: six colours, one size - the
   * constant position first in the label rather than last, and the surviving
   * axis's `index` is 0.
   */
  it('drops a leading constant position and keeps the trailing index honest', () => {
    const split = deriveOptionSplit([
      variant('a', 'Red-M'),
      variant('b', 'Black-M'),
      variant('c', 'Grey-M'),
    ]);

    expect(split?.positions).toEqual([
      { index: 0, values: ['Red', 'Black', 'Grey'] },
    ]);
  });

  /**
   * Structurally impossible to reach a proposal with zero varying positions:
   * with two or more variants and every bucket forced to size one, the
   * cross-product check (`expected === variants.length`) already refuses
   * before the drop step runs. Asserted directly rather than trusted.
   */
  it('cannot derive a proposal where every position is constant', () => {
    expect(
      deriveOptionSplit([variant('a', 'Black-S'), variant('b', 'Black-S')]),
    ).toBe(undefined);
  });

  it('refuses duplicate labels, which would mis-price a selection', () => {
    expect(
      deriveOptionSplit([
        variant('a', 'Black-S'),
        variant('b', 'Black-S'),
        variant('c', 'Red-S'),
        variant('d', 'Red-M'),
      ]),
    ).toBe(undefined);
  });

  it('refuses fewer than two variants', () => {
    expect(deriveOptionSplit([variant('a', 'Black-S')])).toBe(undefined);
  });
});

describe('splitLabelTokens', () => {
  it('trims and drops empty segments so a stray delimiter cannot create a blank', () => {
    expect(splitLabelTokens(' Army Green - XL ')).toEqual(['Army Green', 'XL']);
    expect(splitLabelTokens('Black--S')).toEqual(['Black', 'S']);
  });
});

describe('combinationKeyOf', () => {
  it('round-trips with splitLabelTokens', () => {
    const tokens = splitLabelTokens('Army Green-XL');

    expect(combinationKeyOf(tokens)).toBe('Army Green-XL');
  });
});
