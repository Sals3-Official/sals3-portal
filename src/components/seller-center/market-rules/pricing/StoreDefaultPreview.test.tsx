// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPreviewRows, crossoverCostMinor } from './StoreDefaultPreview';

/**
 * The preview must never disagree with the price a product actually gets,
 * so it calls the resolver's own money-math rather than restating the
 * formula. These lock the numbers a seller reads off the screen.
 */
/**
 * These cases were written around a **35% margin**. The field they describe now
 * takes **markup over cost** (#233), so the input converts and every expected
 * price below is unchanged — `53.846154 / (100 + 53.846154) = 0.350000` exactly,
 * at the six decimal places `parseScaledRate` keeps.
 *
 * Stated as a constant rather than inlined: the number looks arbitrary, and the
 * next reader deserves to know it is one margin in the other unit rather than a
 * value somebody picked.
 */
const MARKUP_FOR_35_MARGIN = '53.846154';

describe('buildPreviewRows', () => {
  it('shows the minimum governing a cheap item and the margin governing a dearer one', () => {
    // 35% margin, US$2.50 floor, no rounding.
    const rows = buildPreviewRows(MARKUP_FOR_35_MARGIN, '2.50', 'NONE');

    expect(rows).not.toBeNull();
    const [cheap, mid, dear] = rows as NonNullable<typeof rows>;

    // 200 / 0.65 = 307.7 -> 308; floor 200 + 250 = 450 wins.
    expect(cheap.priceMinor).toBe(BigInt(450));
    expect(cheap.governedBy).toBe('MINIMUM');

    // 600 / 0.65 = 923; floor 850 loses.
    expect(mid.priceMinor).toBe(BigInt(923));
    expect(mid.governedBy).toBe('MARGIN');

    expect(dear.governedBy).toBe('MARGIN');
  });

  it('reports a higher effective share exactly where the minimum fires — the reason it is an amount, not a percentage', () => {
    const rows = buildPreviewRows(MARKUP_FOR_35_MARGIN, '2.50', 'NONE');
    const [cheap, mid] = rows as NonNullable<typeof rows>;

    // Floor-governed: 250 kept out of 450 = 56%, well above the 35% setting.
    expect(cheap.profitMinor).toBe(BigInt(250));
    expect(cheap.profitPercentOfPrice).toBeGreaterThan(35);

    // Margin-governed rows land on the configured rate.
    expect(mid.profitPercentOfPrice).toBe(35);
  });

  it('a zero floor never fires, whatever the cost', () => {
    const rows = buildPreviewRows(MARKUP_FOR_35_MARGIN, '', 'NONE');

    expect(
      (rows as NonNullable<typeof rows>).every(
        (row) => row.governedBy === 'MARGIN',
      ),
    ).toBe(true);
  });

  it('applies the chosen rounding rule, never rounding below the computed price', () => {
    const plain = buildPreviewRows(MARKUP_FOR_35_MARGIN, '2.50', 'NONE');
    const charm = buildPreviewRows(
      MARKUP_FOR_35_MARGIN,
      '2.50',
      'NEAREST_0_99',
    );

    (charm as NonNullable<typeof charm>).forEach((row, index) => {
      const unrounded = (plain as NonNullable<typeof plain>)[index].priceMinor;
      expect(row.priceMinor).toBeGreaterThanOrEqual(unrounded);
      expect(Number(row.priceMinor) % 100).toBe(99);
    });
  });

  it('returns null for input that is not a usable margin, rather than a fabricated row', () => {
    expect(buildPreviewRows('', '2.50', 'NONE')).toBeNull();
    expect(buildPreviewRows('0', '2.50', 'NONE')).toBeNull();
    // 100 is a perfectly good markup; the ceiling is what refuses now.
    expect(buildPreviewRows('501', '2.50', 'NONE')).toBeNull();
    expect(buildPreviewRows('abc', '2.50', 'NONE')).toBeNull();
    expect(buildPreviewRows(MARKUP_FOR_35_MARGIN, '-1', 'NONE')).toBeNull();
  });
});

describe('crossoverCostMinor', () => {
  it('is floor × (1 − m) / m — the cost where the two rules meet', () => {
    // 2.50 × 0.65 / 0.35 = 4.643 -> 464 minor units.
    expect(crossoverCostMinor(MARKUP_FOR_35_MARGIN, '2.50')).toBe(464);
  });

  it('has no crossover without a floor', () => {
    expect(crossoverCostMinor(MARKUP_FOR_35_MARGIN, '0')).toBeNull();
    expect(crossoverCostMinor(MARKUP_FOR_35_MARGIN, '')).toBeNull();
  });
});

/**
 * The defect the owner hit: a store default that appeared not to work.
 *
 * #233 renamed the dialog's field to markup and left this component reading it
 * as a margin, so `200` — a perfectly ordinary markup — tripped the old
 * `>= 100` guard and returned `null`. The dialog then showed "Type a markup
 * above" no matter what was typed, while the value itself saved correctly.
 * Nothing was wrong with the number; the worked example just never appeared.
 */
describe('the unit this component reads', () => {
  it('builds rows for a markup past 100, which a margin could never be', () => {
    const rows = buildPreviewRows('200', '', 'NONE');

    expect(rows).not.toBeNull();
    // 200% markup is 3x cost, at every sample.
    expect(rows?.map((row) => Number(row.priceMinor))).toEqual([
      600, 1800, 6000,
    ]);
  });

  it('reads the same unit as the crossover, so the two cannot disagree', () => {
    const rows = buildPreviewRows('200', '2.50', 'NONE');
    const crossover = crossoverCostMinor('200', '2.50');

    expect(rows).not.toBeNull();
    // 2.50 x (1 - 0.6667) / 0.6667 = 125 minor units.
    expect(crossover).toBe(125);
  });

  it('still refuses what is not a usable markup', () => {
    expect(buildPreviewRows('', '', 'NONE')).toBeNull();
    expect(buildPreviewRows('0', '', 'NONE')).toBeNull();
    expect(buildPreviewRows('abc', '', 'NONE')).toBeNull();
  });
});
