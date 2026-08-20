'use client';

import Image from 'next/image';
import { ImageOff, Loader } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
 * Nothing is uploaded here. The photos already exist, supplier originals and
 * seller uploads alike, and this only says which variant each one depicts.
 * Uploading belongs to the Media section in Basic Information, which is where a
 * seller already goes to add one — a second upload control on a pricing table
 * would be a second place for the same job to drift.
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
};

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
}: VariantImagePickerProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            Pick from the photos already stored on this product. Add new ones in
            Product media, under Basic Information.
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
