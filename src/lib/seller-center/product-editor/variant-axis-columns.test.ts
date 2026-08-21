import { describe, expect, it } from 'vitest';

import type { VariantFixture } from './types';
import resolveVariantAxisColumns from './variant-axis-columns';

function variant(id: string, optionLabel: string): VariantFixture {
  return {
    id,
    optionLabel,
    sellerSku: `SKU-${id}`,
    supplierCost: { amountMinor: 429, currency: 'USD' },
    retailPrice: { amountMinor: 572, currency: 'USD' },
    supplierStock: 10,
    warehouseLabel: 'CJ warehouse',
    hasImage: false,
    enabled: true,
    listingState: 'WILL_LIST',
    attention: null,
    supplierVariantId: `CJVID-${id}`,
    packedWeightGrams: 100,
    evidenceCapturedAt: '2026-08-22T00:00:00.000Z',
  };
}

describe('resolveVariantAxisColumns', () => {
  it('splits a mapped label into one column per axis, name in the header only', () => {
    const axes = resolveVariantAxisColumns([
      variant('v1', 'Colour: Black, Size: Small'),
      variant('v2', 'Colour: Camel, Size: Large'),
    ]);

    expect(axes?.names).toEqual(['Colour', 'Size']);
    // Values only — the axis name is not repeated into the cell.
    expect(axes?.valuesByVariantId.v1).toEqual(['Black', 'Small']);
    expect(axes?.valuesByVariantId.v2).toEqual(['Camel', 'Large']);
  });

  it('refuses an unmapped supplier token rather than splitting on a hyphen', () => {
    expect(
      resolveVariantAxisColumns([variant('v1', 'Army Green-XL')]),
    ).toBeNull();
  });

  it('refuses when one row has a different axis count', () => {
    // A table whose columns came from the first row would drop `Size: Small`
    // with nothing on screen saying a column is missing.
    expect(
      resolveVariantAxisColumns([
        variant('v1', 'Colour: Black, Size: Small'),
        variant('v2', 'Colour: Camel'),
      ]),
    ).toBeNull();
  });

  it('refuses when the axes disagree in order', () => {
    expect(
      resolveVariantAxisColumns([
        variant('v1', 'Colour: Black, Size: Small'),
        variant('v2', 'Size: Large, Colour: Camel'),
      ]),
    ).toBeNull();
  });

  it('keeps a colon inside a value, splitting only on the first separator', () => {
    const axes = resolveVariantAxisColumns([
      variant('v1', 'Strap: Buckle: wide'),
    ]);

    expect(axes?.names).toEqual(['Strap']);
    expect(axes?.valuesByVariantId.v1).toEqual(['Buckle: wide']);
  });

  it('refuses a pair with an empty name or value', () => {
    expect(resolveVariantAxisColumns([variant('v1', ': Black')])).toBeNull();
    expect(resolveVariantAxisColumns([variant('v1', 'Colour: ')])).toBeNull();
  });

  it('returns nothing for an empty variant list', () => {
    expect(resolveVariantAxisColumns([])).toBeNull();
  });

  it('handles a single-axis product', () => {
    const axes = resolveVariantAxisColumns([
      variant('v1', 'Colour: Black'),
      variant('v2', 'Colour: Camel'),
    ]);

    expect(axes?.names).toEqual(['Colour']);
    expect(axes?.valuesByVariantId.v2).toEqual(['Camel']);
  });
});
