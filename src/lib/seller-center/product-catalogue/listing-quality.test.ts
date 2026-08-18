import { describe, expect, it } from 'vitest';
import { listingQualityOf, listingQualitySignals } from './listing-quality';
import type { CatalogueProductFixture } from './types';

/**
 * A listing that meets every check. Each test below removes exactly one thing,
 * so a failure names the signal that broke rather than "the score changed".
 */
function finished(
  overrides: Partial<CatalogueProductFixture> = {},
): CatalogueProductFixture {
  return {
    ...({
      id: 'product-1',
      name: 'Corduroy Jacket',
      sellingPrice: { amountMinor: 4500, currency: 'USD' },
      mediaStatus: 'OWN_PICTURES',
      contentReadiness: 'GOOD',
      metaDescriptionText:
        'A warm corduroy jacket in two colours and five sizes.',
      categoryCode: 'CAT-GGL-1057',
      optionAxisNames: ['Colour', 'Size'],
      variants: [{ id: 'v1' }, { id: 'v2' }],
      categoryAttributeControls: [
        { attributeName: 'Brand', requirementLevel: 'REQUIRED' },
        { attributeName: 'Style', requirementLevel: 'RECOMMENDED' },
      ],
      categoryAttributeValues: [
        { attributeName: 'Brand', values: ['Generic'], isCustomValue: false },
      ],
      attentionReasons: [],
    } as unknown as CatalogueProductFixture),
    ...overrides,
  };
}

describe('listingQualityOf', () => {
  it('reads HIGH only when every check is met', () => {
    expect(listingQualityOf(finished())).toBe('HIGH');
  });

  /**
   * Owner decision 2026-08-18: supplier media is what a finished listing is
   * meant to move off, so a listing running on the supplier's pictures is not
   * finished however complete its text is.
   */
  it('holds a listing on supplier pictures at MEDIUM, never HIGH', () => {
    expect(
      listingQualityOf(finished({ mediaStatus: 'SUPPLIER_FALLBACK' })),
    ).toBe('MEDIUM');
  });

  it('counts mixed pictures as the seller’s own work', () => {
    expect(listingQualityOf(finished({ mediaStatus: 'MIXED_PICTURES' }))).toBe(
      'HIGH',
    );
  });

  it.each([
    ['no retail price', { sellingPrice: null }],
    ['no publishable picture', { mediaStatus: 'NO_USABLE_PICTURES' as const }],
    ['media awaiting review', { mediaStatus: 'NEEDS_MEDIA_REVIEW' as const }],
    [
      'a required specification unfilled',
      { categoryAttributeValues: [] as never },
    ],
  ])('reads LOW when a listing cannot sell: %s', (_label, overrides) => {
    expect(
      listingQualityOf(finished(overrides as Partial<CatalogueProductFixture>)),
    ).toBe('LOW');
  });

  it.each([
    ['description missing', { contentReadiness: 'NEEDS_IMPROVEMENT' as const }],
    ['meta description unsaved', { metaDescriptionText: '' }],
    ['Variant Matrix unnamed', { optionAxisNames: [] }],
    ['category still a CJ mirror', { categoryCode: 'CJ-1042' }],
  ])('reads MEDIUM when only polish is missing: %s', (_label, overrides) => {
    expect(
      listingQualityOf(finished(overrides as Partial<CatalogueProductFixture>)),
    ).toBe('MEDIUM');
  });

  /**
   * A single-variant product has no axis to name, which is the same shape
   * `deriveOptionSplit` refuses for having fewer than two variants. Demanding a
   * Variant Matrix from it would hold it below HIGH forever.
   */
  it('does not expect a Variant Matrix from a single-variant product', () => {
    expect(
      listingQualityOf(
        finished({
          optionAxisNames: [],
          variants: [
            { id: 'v1' },
          ] as unknown as CatalogueProductFixture['variants'],
        }),
      ),
    ).toBe('HIGH');
  });

  it('passes a category that marks no attribute REQUIRED', () => {
    expect(
      listingQualityOf(
        finished({
          categoryAttributeControls: [
            {
              attributeName: 'Style',
              requirementLevel: 'RECOMMENDED',
            },
          ] as unknown as CatalogueProductFixture['categoryAttributeControls'],
          categoryAttributeValues: [],
        }),
      ),
    ).toBe('HIGH');
  });
});

describe('listingQualitySignals', () => {
  it('names the remaining work rather than only a level', () => {
    const signals = listingQualitySignals(
      finished({ metaDescriptionText: '', mediaStatus: 'SUPPLIER_FALLBACK' }),
    );
    const unmet = signals.filter((signal) => !signal.met).map((s) => s.id);

    expect(unmet).toEqual(['own-media', 'meta-description']);
  });

  it('marks which gaps stop a listing selling at all', () => {
    const signals = listingQualitySignals(finished({ sellingPrice: null }));
    const blocking = signals.filter(
      (signal) => !signal.met && signal.publishCritical,
    );

    expect(blocking.map((signal) => signal.id)).toEqual(['price']);
  });
});
