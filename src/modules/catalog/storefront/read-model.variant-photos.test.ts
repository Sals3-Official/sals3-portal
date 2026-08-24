// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shareFirstAxisPhotos, type StorefrontVariant } from './read-model';

/**
 * The rule that makes a variant photo mean something to a buyer.
 *
 * `product_media_sources.variant_id` holds one id, so the Portal's group
 * control writes a colour's photo onto the first variant carrying that colour.
 * Served raw, that puts a picture on `Black · S` and nothing on `Black · M` —
 * one product, one colour, two different pages. These cases pin the resolution
 * so a consumer never has to know any of it.
 */

const BLACK = 'https://media.example.com/seller-media/p/black.webp';
const WHITE = 'https://media.example.com/seller-media/p/white.webp';

function variant(
  sku: string,
  options: { name: string; value: string }[],
  imageUrl?: string,
): StorefrontVariant {
  return {
    id: `id-${sku}`,
    sku,
    priceMinor: 4299,
    currency: 'USD',
    availability: 'AVAILABLE',
    options,
    ...(imageUrl === undefined ? {} : { imageUrl }),
  };
}

const colour = (value: string) => ({ name: 'Colour', value });
const size = (value: string) => ({ name: 'Size', value });

describe('shareFirstAxisPhotos', () => {
  it('gives every size of a colour the photo assigned to one of them', () => {
    const resolved = shareFirstAxisPhotos([
      variant('BLK-S', [colour('Black'), size('S')], BLACK),
      variant('BLK-M', [colour('Black'), size('M')]),
      variant('BLK-L', [colour('Black'), size('L')]),
    ]);

    // The defect this exists for: without it, only the first row has a photo.
    expect(resolved.map((row) => row.imageUrl)).toEqual([BLACK, BLACK, BLACK]);
  });

  it('never lets one colour borrow another colour"s photo', () => {
    const resolved = shareFirstAxisPhotos([
      variant('BLK-S', [colour('Black'), size('S')], BLACK),
      variant('WHT-S', [colour('White'), size('S')]),
    ]);

    expect(resolved[1]?.imageUrl).toBeUndefined();
  });

  it('keeps a photo the seller assigned to that exact variant', () => {
    const resolved = shareFirstAxisPhotos([
      variant('BLK-S', [colour('Black'), size('S')], BLACK),
      variant('BLK-M', [colour('Black'), size('M')], WHITE),
    ]);

    // A seller who photographs every size individually gets what they assigned;
    // this pass only ever fills an absence.
    expect(resolved[1]?.imageUrl).toBe(WHITE);
  });

  it('does not pool two axes that happen to share a value', () => {
    // `Colour: Natural` and `Material: Natural` are different facts. Keying the
    // group on the value alone would put a colour photo on a material.
    const resolved = shareFirstAxisPhotos([
      variant('NAT-C', [colour('Natural'), size('S')], BLACK),
      variant('NAT-M', [{ name: 'Material', value: 'Natural' }, size('S')]),
    ]);

    expect(resolved[1]?.imageUrl).toBeUndefined();
  });

  it('groups on the leading axis only, so a shared size does not pool', () => {
    const resolved = shareFirstAxisPhotos([
      variant('BLK-S', [colour('Black'), size('S')], BLACK),
      variant('WHT-S', [colour('White'), size('S')]),
    ]);

    // Both are size S. If the pass keyed on any matching axis rather than the
    // first, White would inherit the Black photo.
    expect(resolved[1]?.imageUrl).toBeUndefined();
  });

  it('leaves the single implicit variant of an axis-less product alone', () => {
    const resolved = shareFirstAxisPhotos([
      variant('ONLY', [], BLACK),
      variant('OTHER', []),
    ]);

    expect(resolved[0]?.imageUrl).toBe(BLACK);
    expect(resolved[1]?.imageUrl).toBeUndefined();
  });

  it('returns the same rows untouched when no variant has a photo', () => {
    const rows = [
      variant('BLK-S', [colour('Black'), size('S')]),
      variant('BLK-M', [colour('Black'), size('M')]),
    ];

    expect(shareFirstAxisPhotos(rows)).toEqual(rows);
  });
});
