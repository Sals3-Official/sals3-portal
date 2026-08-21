'use client';

import Image from 'next/image';
import { ImagePlus, Lock } from 'lucide-react';
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
 * That leaves two honestly different cases, and the strip does not blur them:
 *
 * - **One variant carries the value** (a colour-only product — the commonest
 *   shape). The value *is* a variant, so the chip is a real control and what it
 *   writes is exactly what it shows.
 * - **Several variants carry it.** The chip shows one of their photos, says
 *   whose it is, and is not a control. Making it one would set the photo on
 *   `Black / L` under a label reading `Black`, leaving the other three Black
 *   variants photoless on the storefront — a buyer-facing defect, not a
 *   labelling nicety.
 *
 * ## An axis with nothing exact in it is not rendered
 *
 * On a Colour × Size product every colour is carried by four variants and every
 * size by three, so no chip could be a control and a `Size photos` row would be
 * pure noise: nothing about a *size* has a picture, and Sals3 cannot know which
 * axis carries appearance — the same thing that stops it naming the axes in the
 * first place. An axis is rendered only if at least one of its values resolves
 * to exactly one variant. When that removes everything, the strip says where
 * photos do live rather than vanishing, so a seller looking for them is not left
 * searching an empty panel.
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
  const assignable = photo !== undefined && !shared && onPick !== undefined;

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
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left outline-offset-2 transition hover:border-border-strong hover:brightness-95 focus-visible:outline-2"
      >
        {body}
      </button>
    );
  }

  return (
    <span
      className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2 py-1.5"
      title={
        shared && photo !== undefined
          ? `Shown from ${photo.variantLabel}. ${photo.variantCount} variants use this value, so its photo is set on the variant rows below.`
          : undefined
      }
    >
      {body}
      {shared && photo !== undefined ? (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Lock aria-hidden="true" className="size-3" />
          <span className="sr-only">
            Read-only. Photo shown from variant {photo.variantLabel}, one of{' '}
            {photo.variantCount} variants carrying {label}. Set it on the
            variant rows below.
          </span>
          <span aria-hidden="true">{photo.variantLabel}</span>
        </span>
      ) : null}
    </span>
  );
}

export default function VariantValuePhotoStrip({
  axes,
  photos,
  onPick,
}: VariantValuePhotoStripProps) {
  /**
   * Axes carrying at least one value that resolves to exactly one variant —
   * the only values a photo can be set against here. See the note above.
   */
  const shown = axes.filter((axis) =>
    axis.values.some((value) => photos[value.valueId]?.variantCount === 1),
  );

  if (shown.length === 0) {
    const linked = axes.some((axis) =>
      axis.values.some((value) => photos[value.valueId] !== undefined),
    );

    if (!linked) return null;

    return (
      <p className="text-sm text-muted-foreground">
        Every option on this product is shared by several variants, so a photo
        belongs to a variant rather than to one option value. Set them in the
        Image column of the variant list below.
      </p>
    );
  }

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
