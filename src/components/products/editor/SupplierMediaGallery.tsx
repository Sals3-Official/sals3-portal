import Image from 'next/image';
import { formatPixels } from '@/lib/seller-center/product-editor/format';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import {
  MEDIA_RIGHTS_PRESENTATION,
  MEDIA_STORAGE_LABELS,
} from './presentation';

type SupplierMediaGalleryProps = {
  media: MediaItemFixture[];
};

/**
 * The supplier's own photos, shown exactly as `MediaSection` renders a tile —
 * same rights/storage pills, same pixel line, same note — minus every control
 * that implies a seller decision: no reorder arrows, no "Make cover", no
 * "Replace". This is provenance (ADR-011), not something a seller edits, so
 * it lives in Supplier Details rather than beside Media section's own
 * (currently always-empty) upload controls.
 */
export default function SupplierMediaGallery({
  media,
}: SupplierMediaGalleryProps) {
  if (media.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No supplier photo address is recorded for this product yet.
      </p>
    );
  }

  return (
    <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2.5 p-0">
      {media.map((item) => {
        const isRejected = item.rightsCheck === 'REJECTED';

        return (
          <li
            key={item.id}
            className={`flex flex-col gap-1.5 rounded-lg border p-2 ${
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
                  width={144}
                  height={144}
                  loading="lazy"
                  className="size-full object-contain"
                />
              </span>
            )}

            <div className="flex flex-wrap gap-1">
              <EditorStatusPill
                presentation={MEDIA_RIGHTS_PRESENTATION[item.rightsCheck]}
              />
            </div>
            <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
              {MEDIA_STORAGE_LABELS[item.storageState]}
            </span>

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
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
