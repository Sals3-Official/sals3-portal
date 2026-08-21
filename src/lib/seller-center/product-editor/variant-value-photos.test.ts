import { describe, expect, it } from 'vitest';

import type { MappedOptionAxis } from '@/lib/seller-center/product-catalogue/types';
import type { VariantFixture } from './types';
import resolveVariantValuePhotos from './variant-value-photos';

function variant(
  id: string,
  optionLabel: string,
  imageUrl: string | null = null,
): VariantFixture {
  return {
    id,
    optionLabel,
    sellerSku: `SKU-${id}`,
    supplierCost: { amountMinor: 429, currency: 'USD' },
    retailPrice: { amountMinor: 572, currency: 'USD' },
    supplierStock: 10,
    warehouseLabel: 'CJ warehouse',
    hasImage: imageUrl !== null,
    imageUrl,
    imageMediaId: imageUrl === null ? null : `media-${id}`,
    enabled: true,
    listingState: 'WILL_LIST',
    attention: null,
    supplierVariantId: `CJVID-${id}`,
    packedWeightGrams: 100,
    evidenceCapturedAt: '2026-08-22T00:00:00.000Z',
  };
}

function axis(
  optionId: string,
  name: string,
  values: { valueId: string; label: string; variantIds?: string[] }[],
): MappedOptionAxis {
  return {
    optionId,
    name,
    values: values.map((value) => ({
      valueId: value.valueId,
      label: value.label,
      supplierValue: value.label.toLowerCase(),
      ...(value.variantIds === undefined
        ? {}
        : { variantIds: value.variantIds }),
    })),
  };
}

describe('resolveVariantValuePhotos', () => {
  it('pins a single-variant value to that variant, and counts it once', () => {
    const photos = resolveVariantValuePhotos(
      [
        axis('opt-1', 'Colour', [
          { valueId: 'val-black', label: 'Black', variantIds: ['v1'] },
        ]),
      ],
      [variant('v1', 'Colour: Black', 'https://cdn.example/black.webp')],
    );

    expect(photos['val-black']).toEqual({
      variantId: 'v1',
      variantLabel: 'Colour: Black',
      imageUrl: 'https://cdn.example/black.webp',
      mediaId: 'media-v1',
      variantCount: 1,
    });
  });

  it('reports a value carried by several variants as several, so the chip stays read-only', () => {
    const photos = resolveVariantValuePhotos(
      [
        axis('opt-1', 'Colour', [
          {
            valueId: 'val-black',
            label: 'Black',
            variantIds: ['v1', 'v2', 'v3', 'v4'],
          },
        ]),
      ],
      [
        variant('v1', 'Colour: Black, Size: L'),
        variant('v2', 'Colour: Black, Size: M', 'https://cdn.example/m.webp'),
        variant('v3', 'Colour: Black, Size: S'),
        variant('v4', 'Colour: Black, Size: XL'),
      ],
    );

    // The photo comes from the variant that actually has one, and the label
    // names it - a chip standing in for four variants must say whose photo it
    // is showing.
    expect(photos['val-black']?.variantId).toBe('v2');
    expect(photos['val-black']?.variantLabel).toBe('Colour: Black, Size: M');
    expect(photos['val-black']?.variantCount).toBe(4);
  });

  it('still returns an entry when no carrying variant has a photo, pointed at the first', () => {
    const photos = resolveVariantValuePhotos(
      [
        axis('opt-1', 'Colour', [
          { valueId: 'val-pink', label: 'Pink', variantIds: ['v1'] },
        ]),
      ],
      [variant('v1', 'Colour: Pink')],
    );

    // An empty chip is the control a seller presses to set the first photo, so
    // it has to resolve to the row the assignment will write.
    expect(photos['val-pink']).toMatchObject({
      variantId: 'v1',
      imageUrl: null,
      mediaId: null,
      variantCount: 1,
    });
  });

  it('drops a variant id the editor does not hold, rather than counting it', () => {
    const photos = resolveVariantValuePhotos(
      [
        axis('opt-1', 'Colour', [
          {
            valueId: 'val-black',
            label: 'Black',
            variantIds: ['v1', 'missing'],
          },
        ]),
      ],
      [variant('v1', 'Colour: Black')],
    );

    // Counting the unknown id would push this to 2 and silently stop the value
    // being assignable.
    expect(photos['val-black']?.variantCount).toBe(1);
  });

  it('omits a value with no recorded variant link', () => {
    const photos = resolveVariantValuePhotos(
      [axis('opt-1', 'Colour', [{ valueId: 'val-black', label: 'Black' }])],
      [variant('v1', 'Colour: Black')],
    );

    expect(photos['val-black']).toBeUndefined();
  });

  it('returns nothing for an unmapped product or an empty variant list', () => {
    expect(resolveVariantValuePhotos([], [variant('v1', 'x')])).toEqual({});
    expect(
      resolveVariantValuePhotos(
        [axis('opt-1', 'Colour', [{ valueId: 'v', label: 'Black' }])],
        [],
      ),
    ).toEqual({});
  });
});
