import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StoreDefaultPreview, {
  amountReserveMinor,
  buildMarginFloorPreviewRows,
} from './StoreDefaultPreview';

/**
 * The preview must never disagree with the price a product actually gets. It
 * used to guarantee that by running the resolver's own money-math over three
 * sample supplier costs — the right approach while this dialog carried a base
 * markup for those costs to be marked up by.
 *
 * The base markup is gone (2026-08-28), and with it the arithmetic. What is
 * left is a claim about ORDERING — a category under the reserve prices at the
 * reserve — and the cases below hold it to that, including the places where the
 * ordering could silently invert.
 */

describe('buildMarginFloorPreviewRows', () => {
  it('lifts a category under the reserve and leaves one above it alone', () => {
    const rows = buildMarginFloorPreviewRows('50');

    expect(rows).toEqual([
      { categoryPercent: 25, effectivePercent: 50, governedBy: 'MINIMUM' },
      { categoryPercent: 50, effectivePercent: 50, governedBy: 'MARGIN' },
      { categoryPercent: 100, effectivePercent: 100, governedBy: 'MARGIN' },
    ]);
  });

  it('treats a category exactly at the reserve as the category winning', () => {
    // A tie either way, so the only visible difference is the label. It has to
    // read as the category: a seller who set the two to the same number has not
    // been overridden by anything.
    const [, atTheReserve] = buildMarginFloorPreviewRows('80') ?? [];

    expect(atTheReserve).toEqual({
      categoryPercent: 80,
      effectivePercent: 80,
      governedBy: 'MARGIN',
    });
  });

  it('compares markups, which orders the same way the stored margins do', () => {
    /*
      The rows are in markup; the resolver floors on margin rates. That is only
      safe because `k / (100 + k)` is strictly increasing, so the two orderings
      agree — this pins the property rather than the arithmetic.

      200% markup is a 0.666667 margin and 100% is 0.500000, so a table deciding
      on markup and a resolver deciding on margin still rank these identically.
    */
    const rows = buildMarginFloorPreviewRows('200') ?? [];

    expect(rows.map((row) => row.categoryPercent)).toEqual([100, 200, 400]);
    expect(rows.map((row) => row.governedBy)).toEqual([
      'MINIMUM',
      'MARGIN',
      'MARGIN',
    ]);
  });

  it('builds rows past 100, which a margin could never reach', () => {
    // The #233 defect in its original form: the component read this field as a
    // margin and refused anything at or above 100, so an ordinary 200% markup
    // silently rendered no preview at all.
    expect(buildMarginFloorPreviewRows('200')).not.toBeNull();
  });

  it('never samples above the maximum the field itself accepts', () => {
    // The top sample is `floor x 2`, so a reserve near the ceiling would
    // otherwise draw a row the form refuses to save.
    const rows = buildMarginFloorPreviewRows('400') ?? [];

    expect(rows.map((row) => row.categoryPercent)).toEqual([200, 400, 500]);
  });

  it('refuses what is not a usable reserve', () => {
    expect(buildMarginFloorPreviewRows('')).toBeNull();
    expect(buildMarginFloorPreviewRows('0')).toBeNull();
    expect(buildMarginFloorPreviewRows('-10')).toBeNull();
    expect(buildMarginFloorPreviewRows('abc')).toBeNull();
    expect(buildMarginFloorPreviewRows('501')).toBeNull();
  });
});

describe('amountReserveMinor', () => {
  it('reads whole currency into minor units', () => {
    expect(amountReserveMinor('2.50')).toBe(250);
    expect(amountReserveMinor('10')).toBe(1000);
  });

  it('rounds a third decimal rather than truncating it', () => {
    // The action's schema refuses "2.505" outright. Rounding here is the
    // display side agreeing, rather than showing US$2.50 for a value that would
    // be rejected on save.
    expect(amountReserveMinor('2.505')).toBe(251);
  });

  it('treats an empty or zero amount as no reserve at all', () => {
    // Zero is not a case of its own: a floor of nothing floors nothing, and
    // drawing it would claim a rule where there is none.
    expect(amountReserveMinor('')).toBeNull();
    expect(amountReserveMinor('   ')).toBeNull();
    expect(amountReserveMinor('0')).toBeNull();
    expect(amountReserveMinor('-1')).toBeNull();
    expect(amountReserveMinor('abc')).toBeNull();
  });
});

describe('what the dialog shows', () => {
  it('draws the category table for a percentage reserve', () => {
    render(<StoreDefaultPreview floorAmount="" floorPercent="50" />);

    expect(screen.getByText('What the reserve does')).toBeInTheDocument();
    expect(screen.getByText('A category set to')).toBeInTheDocument();
  });

  it('states the amount reserve in one sentence, with no table', () => {
    render(<StoreDefaultPreview floorAmount="2.50" floorPercent="" />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(
      screen.getByText(/at least US\$2\.50 above what you pay the supplier/),
    ).toBeInTheDocument();
  });

  it('draws one answer, not two, when both somehow arrive', () => {
    // The form disables one field once the other has a value and
    // `pricing_store_defaults_floor_exclusive` refuses a row carrying both, so
    // this is unreachable through the screen. Pinned anyway: the component must
    // never show two rules at once, and the percentage is the one the resolver
    // checks first.
    render(<StoreDefaultPreview floorAmount="2.50" floorPercent="50" />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText(/above what you pay the supplier/)).toBeNull();
  });

  it('says plainly that nothing is set rather than prompting for a markup', () => {
    // The old copy read "Type a markup above", naming a field this dialog no
    // longer has.
    render(<StoreDefaultPreview floorAmount="" floorPercent="" />);

    expect(screen.getByText(/No reserve set/)).toBeInTheDocument();
  });
});
