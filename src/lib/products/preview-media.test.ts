// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import previewMedia from './preview-media';

function media(
  overrides: Partial<MediaItemFixture> & { id: string },
): MediaItemFixture {
  return {
    label: overrides.id,
    sourceUrl: `https://example.test/${overrides.id}.webp`,
    altText: overrides.id,
    rightsCheck: 'VERIFIED',
    storageState: 'SALS3_STORED',
    sourceType: 'SELLER_UPLOAD',
    pixelWidth: 1200,
    pixelHeight: 1200,
    note: null,
    isCover: false,
    ...overrides,
  };
}

const OWN = media({ id: 'own-1' });
const SUPPLIER = media({ id: 'sup-1', sourceType: 'SUPPLIER_ORIGINAL' });
const EVIDENCE = media({ id: 'evidence-1', sourceType: 'SUPPLIER_ORIGINAL' });

describe('previewMedia', () => {
  /**
   * The regression this function exists for. The preview used to compute
   * `[...gallery, ...supplierMedia]`, which was right while the gallery held
   * seller uploads alone. Once supplier originals joined the gallery grid
   * (ADR-011 amendment 2026-08-28) that rendered every supplier photo twice —
   * silently, because a duplicate slide is not an error, just a wrong preview
   * of a real storefront.
   */
  it('never repeats a supplier photo that is already a gallery row', () => {
    const result = previewMedia([OWN, SUPPLIER], [EVIDENCE], true);

    expect(result).toEqual([OWN, SUPPLIER]);
    expect(result.filter((item) => item.id === SUPPLIER.id)).toHaveLength(1);
    expect(result).not.toContain(EVIDENCE);
  });

  it('shows the whole gallery while the supplier switch is on', () => {
    expect(previewMedia([OWN, SUPPLIER], [EVIDENCE], true)).toEqual([
      OWN,
      SUPPLIER,
    ]);
  });

  it('hides the supplier rows when the switch is off and an upload exists', () => {
    expect(previewMedia([OWN, SUPPLIER], [EVIDENCE], false)).toEqual([OWN]);
  });

  /**
   * Owner decision 2026-08-20: an empty gallery falls back to the supplier
   * photo rather than rendering a blank page. The switch may only hide the
   * supplier's original once there is something to show in its place.
   */
  it('keeps the supplier rows when the switch is off but nothing was uploaded', () => {
    expect(previewMedia([SUPPLIER], [EVIDENCE], false)).toEqual([SUPPLIER]);
  });

  it('falls back to supplier evidence when no gallery row exists at all', () => {
    expect(previewMedia([], [EVIDENCE], true)).toEqual([EVIDENCE]);
    expect(previewMedia([], [EVIDENCE], false)).toEqual([EVIDENCE]);
  });

  it('shows nothing when there is neither a gallery nor supplier evidence', () => {
    expect(previewMedia([], [], true)).toEqual([]);
  });
});
