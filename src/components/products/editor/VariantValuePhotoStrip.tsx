'use client';

import Image from 'next/image';
import { ImagePlus } from 'lucide-react';
import type { MappedOptionAxis } from '@/lib/seller-center/product-catalogue/types';
import type { VariantMatrixValuePhoto } from '@/lib/seller-center/product-editor/types';

/**
 * Photos, one per Variant Matrix value, where a seller already thinks about
 * them.
 *
 * ## Why this is a strip and not a column in the value rows
 *
 * A buyer meets these values as a row of choices — the colour swatches under a
 * product photo — so a row of thumbnails is the shape the seller is already
 * picturing. It also keeps the value rows exactly as they are: those rows are a
 * three-column grid whose headers live in `VariantMatrixAxisCard`, and widening
 * both in step to carry a fourth cell buys nothing this does not.
 *
 * ## No schema change, and what that costs
 *
 * Media attaches to a **variant** (`product_media_sources.variant_id`, one
 * nullable column that `assignVariantMedia` moves rather than copies) and
 * `product_media_sources_product_checksum_key` makes the same file
 * unrepeatable inside a product. So one photo genuinely cannot belong to the
 * four variants carrying `black`. Rather than add a column to a table written
 * by draft creation, publication, every seller upload and the supplier mirror,
 * this reads the link that already exists: a value's photo is the photo of a
 * variant carrying it.
 *
 * ## Every value is a control, including a shared one — changed 2026-08-24
 *
 * This used to lock a chip whose value several variants carry, on the reasoning
 * that setting the photo on `Black / L` under a label reading `Black` would
 * "leave the other three Black variants photoless on the storefront". **That is
 * no longer true and the lock went with it.** The storefront read model now
 * resolves a variant's photo across its first option axis
 * (`shareFirstAxisPhotos`), so one photo assigned against `Black / S` is what a
 * buyer sees for every size of Black. The buyer-facing defect the lock existed
 * to prevent cannot happen.
 *
 * Leaving it locked would also have put two controls for one fact in
 * disagreement: the Variants & Pricing rail has always written a group photo
 * this way, so a seller could do from the table exactly what this panel told
 * them was impossible.
 *
 * The chip still says which variant the file is stored against when the value is
 * shared. That is a true and useful thing to know — the row it lands on is the
 * one an order line freezes — and it is a hint rather than a refusal.
 *
 * A product whose matrix is not saved yet gets no strip at all: option values
 * are written by `saveOptionMapping`, so before that there is nothing in the
 * database for a photo to hang from.
 */

export type VariantValuePhotoStripProps = {
  axes: MappedOptionAxis[];
  /** Keyed by `valueId`. A missing entry means no variant link was recorded. */
  photos: Record<string, VariantMatrixValuePhoto>;
  /**
   * Opens the photo picker for one variant. Omitted wherever no real media can
   * be assigned — fixture mode, or a product with no stored photos — in which
   * case every chip reports its state without offering a dead control.
   */
  onPick?: (variantId: string) => void;
};

/** 36px drawn from a 72px source: a thumbnail, not a render of the photo. */
const THUMBNAIL_SOURCE_PIXELS = 72;

/**
 * Blank counts as absent, decided once.
 *
 * `next/image` throws at render on an empty `src`, and this value travels from
 * a database column through a projection, so `null` is not the only way for it
 * to carry nothing. Normalising it in one place is not tidiness: a first
 * attempt checked for blank inside `Thumbnail` only, and the chip then drew an
 * empty placeholder under a button reading **Change photo** — two pieces of one
 * component disagreeing about whether a photo exists.
 */
function presentableUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined) return null;

  return url.trim() === '' ? null : url;
}

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  if (url === null) {
    return (
      <span className="flex size-9 items-center justify-center rounded-md border border-dashed border-border-strong text-muted-foreground">
        <ImagePlus aria-hidden="true" className="size-3.5" />
      </span>
    );
  }

  return (
    <Image
      src={url}
      alt={alt}
      width={THUMBNAIL_SOURCE_PIXELS}
      height={THUMBNAIL_SOURCE_PIXELS}
      loading="lazy"
      className="size-9 rounded-md border border-border object-cover"
    />
  );
}

function ValueChip({
  label,
  photo,
  onPick,
}: {
  label: string;
  photo: VariantMatrixValuePhoto | undefined;
  onPick?: ((variantId: string) => void) | undefined;
}) {
  const url = presentableUrl(photo?.imageUrl);
  const shared = photo !== undefined && photo.variantCount > 1;
  const assignable = photo !== undefined && onPick !== undefined;

  const body = (
    <>
      {/* Decorative here: the chip's own text names the value, so alt text
          would make a screen reader say it twice. */}
      <Thumbnail url={url} alt="" />
      <span className="max-w-24 truncate text-xs font-medium">{label}</span>
    </>
  );

  if (assignable && photo !== undefined) {
    return (
      <button
        type="button"
        onClick={() => onPick(photo.variantId)}
        // The value is in the name, because a strip of identical
        // "Choose photo" buttons names none of them.
        aria-label={`${url === null ? 'Choose' : 'Change'} photo for ${label}`}
        // Said on the control rather than after the fact: the file lands on one
        // variant and an order line freezes that row, so a seller who cares
        // which one can see it before pressing.
        title={
          shared
            ? `One photo for ${label}. Stored against ${photo.variantLabel}, and shown for all ${photo.variantCount} variants carrying ${label}.`
            : undefined
        }
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left outline-offset-2 transition hover:border-border-strong hover:brightness-95 focus-visible:outline-2"
      >
        {body}
        {shared ? (
          <span className="sr-only">
            One photo for {label}, stored against variant {photo.variantLabel}{' '}
            and shown for all {photo.variantCount} variants carrying {label}.
          </span>
        ) : null}
      </button>
    );
  }

  /**
   * No `onPick` — fixture mode, or a product with no stored photos to choose
   * from. It reports what it shows and offers no dead control.
   *
   * The lock icon and the "set it on the variant rows below" copy that used to
   * live here are gone with the lock itself: this branch is no longer a refusal
   * to edit a shared value, it is the absence of anything to edit *with*, and
   * pointing a seller at the variant rows would send them somewhere equally
   * empty.
   */
  return (
    <span className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2 py-1.5">
      {body}
    </span>
  );
}

export default function VariantValuePhotoStrip({
  axes,
  photos,
  onPick,
}: VariantValuePhotoStripProps) {
  /**
   * Axes carrying at least one value that resolved to a variant at all.
   *
   * Was `variantCount === 1` while shared values were locked, which hid the
   * whole strip on a Colour × Size product — the shape this panel is most
   * useful for. A value with no entry has no variant link recorded, so there is
   * nothing for a photo to hang from and nothing to draw.
   */
  const shown = axes.filter((axis) =>
    axis.values.some((value) => photos[value.valueId] !== undefined),
  );

  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {shown.map((axis) => (
        <div key={axis.optionId} className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">
            {axis.name} photos
          </span>
          <div className="flex flex-wrap gap-2">
            {axis.values.map((value) => (
              <ValueChip
                key={value.valueId}
                label={value.label}
                photo={photos[value.valueId]}
                onPick={onPick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
