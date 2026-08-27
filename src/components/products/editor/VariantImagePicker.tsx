'use client';

import Image from 'next/image';
import { ImageOff, Loader, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IMAGE_UPLOAD_LIMITS_COPY } from '@/lib/products/image-upload-limits';
import type { AssignableMediaFixture } from '@/lib/seller-center/product-catalogue/types';
import { cn } from '@/lib/utils';

/**
 * Choosing which stored photo a variant shows.
 *
 * The Variant Matrix has always had an Image column and it has always been a
 * placeholder: `product_media_sources.variant_id` existed, the read model
 * reported from it, and nothing could write it — so a seller with twelve photos
 * uploaded looked at ten rows of "No variant image" with no control to press.
 *
 * ## Uploading here is a different job, not a second copy of one (2026-08-28)
 *
 * This used to refuse to carry an upload control, on the reasoning that
 * "uploading belongs to the Media section in Basic Information … a second
 * upload control on a pricing table would be a second place for the same job to
 * drift". That reasoning held only while every seller upload landed in one pool
 * and one budget. It no longer does: a variation photo is inserted with
 * `variant_id` already set, counts against the per-variation budget rather than
 * the gallery's twelve, and never becomes a slide in the buyer's gallery
 * (`storefront/read-model.ts`'s `loadApprovedImages`). Uploading *here* is
 * therefore not the Media section's job performed in a second place — it is the
 * only place the other job can be done in one step.
 *
 * The old route still works and is still the honest one for a gallery photo:
 * upload in Product media, then pick it here, and `assignVariantMedia` moves it
 * across. What is gone is the requirement to spend a gallery slot on the way.
 *
 * Picking from what already exists stays first in the dialog, because on a
 * product whose photos are already uploaded that is the shorter path.
 *
 * A photo already pointed at another variant is shown, labelled with that
 * variant, and selectable: one photo depicts one variant, so choosing it here
 * moves it rather than copying it, and hiding it would leave a seller unable to
 * correct a mistake they can see.
 */

export type VariantImagePickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The variant being given a photo, for the title and the labels. */
  variantLabel: string;
  variantId: string;
  media: AssignableMediaFixture[];
  /** The media row this variant currently holds, if any. */
  currentMediaId: string | null;
  /** `null` clears the variant's photo. Reports its own refusal message. */
  onAssign: (
    mediaId: string | null,
  ) => Promise<{ ok: boolean; message?: string }>;
  /**
   * Uploads one file straight onto this variant. Omitted in fixture/preview
   * mode, where no real product exists to attach it to — the control is then
   * absent rather than present and dead.
   */
  onUpload?: (file: File) => Promise<{ ok: boolean; message?: string }>;
};

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp';

const SOURCE_LABEL: Record<AssignableMediaFixture['sourceType'], string> = {
  SUPPLIER_ORIGINAL: "Supplier's photo",
  SELLER_UPLOAD: 'Your photo',
};

export default function VariantImagePicker({
  open,
  onOpenChange,
  variantLabel,
  variantId,
  media,
  currentMediaId,
  onAssign,
  onUpload,
}: VariantImagePickerProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (onUpload === undefined) return;

    setPending('upload');
    setError(null);

    const result = await onUpload(file);

    setPending(null);

    if (!result.ok) {
      setError(result.message ?? 'That photo could not be uploaded.');

      return;
    }

    onOpenChange(false);
  }

  async function choose(mediaId: string | null) {
    setPending(mediaId ?? 'clear');
    setError(null);

    const result = await onAssign(mediaId);

    setPending(null);

    if (!result.ok) {
      setError(result.message ?? 'That photo could not be linked.');

      return;
    }

    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-base">
            Photo for {variantLabel}
          </DialogTitle>
          <DialogDescription>
            Pick from the photos already stored on this product, or upload one
            just for this variation. A variation photo does not use a Product
            media slot.
          </DialogDescription>
        </DialogHeader>

        {media.length === 0 ? (
          <p className="m-0 flex items-center gap-2 rounded-lg border border-dashed border-border-strong p-4 text-[13px] text-ink-muted">
            <ImageOff aria-hidden="true" className="size-4" />
            This product has no stored photos yet.
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
            {media.map((item) => {
              const isCurrent = item.mediaId === currentMediaId;
              const heldElsewhere =
                item.variantId !== null && item.variantId !== variantId;

              return (
                <li key={item.mediaId}>
                  <button
                    type="button"
                    disabled={pending !== null}
                    aria-pressed={isCurrent}
                    onClick={() => {
                      choose(item.mediaId).catch(() =>
                        setError('That photo could not be linked.'),
                      );
                    }}
                    className={cn(
                      'relative block w-full overflow-hidden rounded-lg border bg-muted/40 p-0 transition',
                      isCurrent
                        ? 'border-[#018CC9] ring-2 ring-[#018CC9]/30'
                        : 'border-border hover:border-border-strong',
                      pending !== null && 'opacity-60',
                    )}
                  >
                    <span className="block aspect-square">
                      <Image
                        src={item.url}
                        // The photo is the choice, and the text below names it.
                        // A repeated alt on every tile would read the same
                        // sentence four times to a screen reader.
                        alt=""
                        width={120}
                        height={120}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </span>
                    <span className="block truncate px-1.5 py-1 text-left text-[11px] text-muted-foreground">
                      {heldElsewhere
                        ? 'On another variant'
                        : SOURCE_LABEL[item.sourceType]}
                    </span>
                    {pending === item.mediaId ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-card/60">
                        <Loader
                          aria-hidden="true"
                          className="size-4 animate-spin"
                        />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {onUpload === undefined ? null : (
          <div className="border-t border-border pt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              hidden
              onChange={(event) => {
                const control = event.target;
                const file = control.files?.[0];

                // Reset first, so choosing the same file again still fires
                // `onChange` even when this upload is refused. Same idiom as
                // `ProductPhotoManager`: read the element out of the event
                // rather than assigning through the parameter.
                control.value = '';

                if (file !== undefined) {
                  upload(file).catch(() =>
                    setError('That photo could not be uploaded.'),
                  );
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending !== null}
              onClick={() => fileInputRef.current?.click()}
            >
              {pending === 'upload' ? (
                <Loader aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Upload aria-hidden="true" className="size-4" />
              )}
              {pending === 'upload'
                ? 'Uploading…'
                : 'Upload a photo for this variation'}
            </Button>
            <p className="mt-1.5 mb-0 text-[11.5px] text-ink-subtle">
              {IMAGE_UPLOAD_LIMITS_COPY} · one photo per variation.
            </p>
          </div>
        )}

        {error === null ? null : (
          <p role="alert" className="m-0 text-[13px] text-destructive">
            {error}
          </p>
        )}

        {currentMediaId === null ? null : (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending !== null}
              onClick={() => {
                choose(null).catch(() =>
                  setError('That photo could not be unlinked.'),
                );
              }}
            >
              Remove this variant&apos;s photo
            </Button>
            {/* Said plainly, because "remove" beside a photo usually means
                delete: this returns the photo to the product, it does not
                delete a file. */}
            <p className="mt-1.5 mb-0 text-[11.5px] text-ink-subtle">
              The photo stays in Product media. Only the link to this variant is
              removed.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
