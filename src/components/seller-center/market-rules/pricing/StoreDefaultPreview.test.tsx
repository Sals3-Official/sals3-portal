// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPreviewRows, crossoverCostMinor } from './StoreDefaultPreview';

/**
 * The preview must never disagree with the price a product actually gets,
 * so it calls the resolver's own money-math rather than restating the
 * formula. These lock the numbers a seller reads off the screen.
 */
describe('buildPreviewRows', () => {
  it('shows the minimum governing a cheap item and the margin governing a dearer one', () => {
    // 35% margin, US$2.50 floor, no rounding.
    const rows = buildPreviewRows('35', '2.50', 'NONE');

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
    const rows = buildPreviewRows('35', '2.50', 'NONE');
    const [cheap, mid] = rows as NonNullable<typeof rows>;

    // Floor-governed: 250 kept out of 450 = 56%, well above the 35% setting.
    expect(cheap.profitMinor).toBe(BigInt(250));
    expect(cheap.profitPercentOfPrice).toBeGreaterThan(35);

    // Margin-governed rows land on the configured rate.
    expect(mid.profitPercentOfPrice).toBe(35);
  });

  it('a zero floor never fires, whatever the cost', () => {
    const rows = buildPreviewRows('35', '', 'NONE');

    expect(
      (rows as NonNullable<typeof rows>).every(
        (row) => row.governedBy === 'MARGIN',
      ),
    ).toBe(true);
  });

  it('applies the chosen rounding rule, never rounding below the computed price', () => {
    const plain = buildPreviewRows('35', '2.50', 'NONE');
    const charm = buildPreviewRows('35', '2.50', 'NEAREST_0_99');

    (charm as NonNullable<typeof charm>).forEach((row, index) => {
      const unrounded = (plain as NonNullable<typeof plain>)[index].priceMinor;
      expect(row.priceMinor).toBeGreaterThanOrEqual(unrounded);
      expect(Number(row.priceMinor) % 100).toBe(99);
    });
  });

  it('returns null for input that is not a usable margin, rather than a fabricated row', () => {
    expect(buildPreviewRows('', '2.50', 'NONE')).toBeNull();
    expect(buildPreviewRows('0', '2.50', 'NONE')).toBeNull();
    expect(buildPreviewRows('100', '2.50', 'NONE')).toBeNull();
    expect(buildPreviewRows('abc', '2.50', 'NONE')).toBeNull();
    expect(buildPreviewRows('35', '-1', 'NONE')).toBeNull();
  });
});

describe('crossoverCostMinor', () => {
  it('is floor × (1 − m) / m — the cost where the two rules meet', () => {
    // 2.50 × 0.65 / 0.35 = 4.643 -> 464 minor units.
    expect(crossoverCostMinor('35', '2.50')).toBe(464);
  });

  it('has no crossover without a floor', () => {
    expect(crossoverCostMinor('35', '0')).toBeNull();
    expect(crossoverCostMinor('35', '')).toBeNull();
  });
});
