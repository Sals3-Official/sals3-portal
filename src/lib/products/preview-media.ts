import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';

/**
 * The gallery a buyer would actually be served, for the editor's Draft
 * Storefront Preview.
 *
 * This is the editor's copy of a storefront rule — `storefront/read-model.ts`'s
 * `mediaVisibleToBuyers` — and the only reason the preview is worth trusting is
 * that the two agree. It lives here, addressable and pure, so a test can pin
 * that agreement instead of it being asserted in a comment.
 *
 * The rule, in the order it decides:
 *
 * 1. **No gallery rows at all** — the illustrative fixtures, and any product
 *    whose media has not been projected yet. The supplier's evidence is all
 *    there is, and showing it is what the storefront does too.
 * 2. **A seller's own upload always shows.**
 * 3. **The supplier's original shows while the switch is on** — the default.
 * 4. **The switch off hides the supplier's original only once a gallery seller
 *    upload exists.** With nothing uploaded, the supplier photo still renders:
 *    an empty gallery falling back to the supplier photo beats rendering a
 *    blank page (owner decision 2026-08-20), and the editor's own caption
 *    already promises exactly that.
 *
 * ## The bug this replaced
 *
 * The preview used to compute `[...media, ...supplierMedia]`, which was correct
 * while `media` held the seller's uploads alone. When the gallery grid became
 * one list of both origins (ADR-011 amendment 2026-08-28), `media` started
 * carrying the supplier's rows itself — and concatenating `supplierMedia` on
 * top rendered **every supplier photo twice**. Nothing failed: the preview just
 * quietly showed a product with duplicate slides, which is the kind of wrong a
 * seller reads as a real storefront.
 *
 * Note step 4 tests `SELLER_UPLOAD` rows *in the gallery*, not any seller
 * upload anywhere. A variation photo is a seller upload that is not a gallery
 * slide, and counting it here would hide the supplier photo with nothing to put
 * in its place — the same trap the storefront's own `hasApprovedSellerUpload`
 * had to be scoped against.
 */
export default function previewMedia(
  gallery: MediaItemFixture[],
  supplierMedia: MediaItemFixture[],
  showSupplierPhoto: boolean,
): MediaItemFixture[] {
  if (gallery.length === 0) return supplierMedia;

  const ownUploads = gallery.filter(
    (item) => item.sourceType === 'SELLER_UPLOAD',
  );

  if (showSupplierPhoto || ownUploads.length === 0) return gallery;

  return ownUploads;
}
