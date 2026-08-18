// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// `read-model.ts` is `server-only`, which throws on import outside a Server
// Component. Same convention as `read-model.editor-projection.test.ts`: the
// guard stays intact and this stands it down to reach a pure function inside.
vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import type { ProductMediaSourceRow } from '@/lib/db/schema';
import { mediaStatusOf } from './read-model';
/* eslint-enable import/first */

function row(
  sourceType: ProductMediaSourceRow['sourceType'],
): ProductMediaSourceRow {
  return { sourceType } as unknown as ProductMediaSourceRow;
}

/**
 * The defect reported from UAT on 2026-08-18: every draft in the Product
 * Catalogue read "Own pictures" while holding no seller upload at all. The
 * derivation was `media.length > 0 ? 'OWN_PICTURES' : ...`, which counted any
 * row — and drafting projects the supplier's own photo in as
 * `SUPPLIER_ORIGINAL`. The catalogue told sellers their own photography was
 * live when the supplier's was, and because one status was reachable,
 * `MediaStatusBadge`'s other tones never rendered either.
 */
describe('mediaStatusOf', () => {
  it('does not call a supplier photo the seller’s own', () => {
    expect(mediaStatusOf([row('SUPPLIER_ORIGINAL')], true)).toBe(
      'SUPPLIER_FALLBACK',
    );
  });

  it('reports the seller’s own pictures only when a seller uploaded one', () => {
    expect(mediaStatusOf([row('SELLER_UPLOAD')], true)).toBe('OWN_PICTURES');
  });

  it('reports both sources as mixed rather than picking one', () => {
    expect(
      mediaStatusOf([row('SELLER_UPLOAD'), row('SUPPLIER_ORIGINAL')], true),
    ).toBe('MIXED_PICTURES');
  });

  /**
   * Supplier media present but suppressed, and no seller upload: nothing is left
   * to render, so this is a publication blocker rather than a silently empty
   * gallery.
   */
  it('reports nothing usable when the supplier photo is switched off', () => {
    expect(mediaStatusOf([row('SUPPLIER_ORIGINAL')], false)).toBe(
      'NO_USABLE_PICTURES',
    );
  });

  it('a seller upload stands on its own with the supplier photo off', () => {
    expect(mediaStatusOf([row('SELLER_UPLOAD')], false)).toBe('OWN_PICTURES');
  });

  it('reports no media at all as needing review', () => {
    expect(mediaStatusOf([], true)).toBe('NEEDS_MEDIA_REVIEW');
  });
});
