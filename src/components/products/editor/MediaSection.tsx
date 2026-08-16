import { useRef } from 'react';
import Image from 'next/image';
import { ArrowLeft, ArrowRight, Upload, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatPixels } from '@/lib/seller-center/product-editor/format';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import {
  MEDIA_RIGHTS_PRESENTATION,
  MEDIA_STORAGE_LABELS,
} from './presentation';

type MediaSectionProps = {
  media: MediaItemFixture[];
  onMakeCover: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  /** Omitted for fixture/design-preview mode — no real product to attach a photo to. */
  onUpload?: (files: FileList) => void | Promise<void>;
  isUploading?: boolean;
};

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp';

/**
 * Media management for the seller's **own** uploaded photos only
 * (ADR-011) - `product_media_sources` rows with `sourceType: 'SELLER_UPLOAD'`.
 * The supplier's own photos are read-only provenance shown instead in Basic
 * Information's Supplier Details (`SupplierMediaGallery`), never here: they
 * are not the seller's to reorder, pick a cover from, or replace.
 *
 * Two independent label families that must never be conflated:
 *
 * - the **rights check** - Verified / Pending verification / Rejected;
 * - the **storage state** - Uploaded to Sals3 / Pending import / Storage
 *   status unavailable.
 *
 * Ordering and cover selection are real and local - they change what the
 * draft preview shows. Upload is real when `onUpload` is passed (a real
 * product to attach a photo to, and Vercel Blob configured server-side);
 * otherwise it stays disabled and says why, same as Add video, which has no
 * upload path at all yet.
 *
 * Empty is the honest, currently-universal state: no upload path exists to
 * write a `SELLER_UPLOAD` row, so every real product renders the empty state
 * below rather than borrowing the supplier's picture to avoid looking bare.
 */
export default function MediaSection({
  media,
  onMakeCover,
  onMove,
  onUpload,
  isUploading = false,
}: MediaSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const { files } = input;

    if (files !== null && files.length > 0) onUpload?.(files);

    // Reset so selecting the exact same file again still fires `onChange`.
    input.value = '';
  };

  const uploadControls = (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        hidden
        onChange={handleFilesSelected}
      />
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={onUpload === undefined || isUploading}
        title={
          onUpload === undefined
            ? 'Uploading media needs a storage backend, which does not exist yet'
            : undefined
        }
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload aria-hidden="true" />
        {isUploading ? 'Uploading…' : 'Upload image'}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled
        title="Video needs a storage backend, which does not exist yet"
      >
        <Video aria-hidden="true" />
        Add video (optional)
      </Button>
    </div>
  );

  if (media.length === 0) {
    return (
      <div className="flex flex-col gap-3.5">
        <div className="rounded-lg border border-dashed border-border-strong bg-background p-4 text-sm text-muted-foreground">
          No photos have been uploaded for this product yet. Until you upload
          your own, the storefront automatically shows the supplier&apos;s
          original photos — see Supplier Details in Basic Information.
        </div>

        {uploadControls}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-xs text-muted-foreground">
        The first image is the storefront cover. Reordering and cover choice
        apply to this draft immediately and show up in the preview.
      </p>

      <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3 p-0">
        {media.map((item, index) => {
          const isRejected = item.rightsCheck === 'REJECTED';

          return (
            <li
              key={item.id}
              className={`flex flex-col gap-2 rounded-lg border p-2.5 ${
                isRejected
                  ? 'border-red-600 bg-danger-surface/30'
                  : 'border-border bg-card'
              }`}
            >
              {item.sourceUrl === null ? (
                <span
                  aria-hidden="true"
                  className="flex aspect-square items-center justify-center rounded-md border border-border bg-muted font-mono text-xs text-muted-foreground"
                >
                  {item.label}
                </span>
              ) : (
                <span className="block aspect-square overflow-hidden rounded-md border border-border bg-muted">
                  <Image
                    src={item.sourceUrl}
                    alt={item.altText}
                    width={192}
                    height={192}
                    loading="lazy"
                    /* `object-contain` rather than `cover`: cropping a photo in
                       the tool used to review it can hide the thing being
                       reviewed. `bg-muted` letterboxes a non-square photo. */
                    className="size-full object-contain"
                  />
                </span>
              )}

              <div className="flex flex-wrap gap-1.5">
                <EditorStatusPill
                  presentation={MEDIA_RIGHTS_PRESENTATION[item.rightsCheck]}
                />
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                  {MEDIA_STORAGE_LABELS[item.storageState]}
                </span>
              </div>

              <p className="text-xs text-muted-foreground tabular-nums">
                {formatPixels(item.pixelWidth, item.pixelHeight)}
              </p>

              {item.note === null ? null : (
                <p
                  role={isRejected ? 'alert' : undefined}
                  className={`text-xs leading-relaxed ${
                    isRejected ? 'text-red-600' : 'text-muted-foreground'
                  }`}
                >
                  {item.note}
                  {isRejected
                    ? ' It is excluded from the listing until it is replaced.'
                    : ''}
                </p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={index === 0}
                  aria-label={`Move ${item.label} earlier`}
                  onClick={() => onMove(item.id, -1)}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={index === media.length - 1}
                  aria-label={`Move ${item.label} later`}
                  onClick={() => onMove(item.id, 1)}
                >
                  <ArrowRight aria-hidden="true" />
                </Button>

                {item.isCover ? (
                  <span className="rounded-full bg-sidebar px-2 py-0.5 text-xs font-semibold text-sidebar-foreground">
                    Cover
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isRejected}
                    title={
                      isRejected
                        ? 'A rejected image cannot be the storefront cover'
                        : undefined
                    }
                    onClick={() => onMakeCover(item.id)}
                  >
                    Make cover
                  </Button>
                )}

                {isRejected ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled
                    title="Replacing an image needs a media upload backend, which does not exist yet"
                  >
                    Replace
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {uploadControls}

      <div className="rounded-lg border border-border p-3 text-xs leading-relaxed text-ink-muted">
        <p className="font-semibold">What the status labels mean</p>
        <p>
          Verified · Pending verification · Rejected describe the media-rights
          check. Uploaded to Sals3 · Pending import · Storage status unavailable
          describe where the file lives.
        </p>
      </div>
    </div>
  );
}
