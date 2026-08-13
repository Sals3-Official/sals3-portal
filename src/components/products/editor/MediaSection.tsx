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
};

/**
 * Media management with two independent label families that must never be
 * conflated:
 *
 * - the **rights check** - Verified / Pending verification / Rejected;
 * - the **storage state** - Supplier-hosted source / Pending import /
 *   Storage status unavailable.
 *
 * "Verified" says the image is cleared for use. It does not say Sals3 has
 * a copy of it. Nothing in this repo copies supplier media into
 * Sals3-controlled storage today, so no label here may imply that it has.
 *
 * Ordering and cover selection are real and local - they change what the
 * draft preview shows. Replace, Upload and Add video are disabled and say
 * why: there is no media upload or storage backend, and a control that
 * silently did nothing would be worse than one that admits it.
 *
 * A tile with a `sourceUrl` renders that photo; a tile without one renders its
 * label in a placeholder box. Both cases are real: a database-backed product
 * carries the supplier address the catalogue actually stores, while the
 * illustrative fixtures carry none, because a fictional product must not be
 * illustrated with a real supplier's photograph.
 */
export default function MediaSection({
  media,
  onMakeCover,
  onMove,
}: MediaSectionProps) {
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

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled
          title="Uploading media needs a storage backend, which does not exist yet"
        >
          <Upload aria-hidden="true" />
          Upload image
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

      <div className="rounded-lg border border-border p-3 text-xs leading-relaxed text-ink-muted">
        <p className="font-semibold">What the status labels mean</p>
        <p>
          Verified · Pending verification · Rejected describe the media-rights
          check. Supplier-hosted source · Pending import · Storage status
          unavailable describe where the file lives. Nothing here claims an
          image has been copied into Sals3-controlled storage.
        </p>
      </div>
    </div>
  );
}
