import Image from 'next/image';
import { CircleCheck, Clock, OctagonAlert } from 'lucide-react';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import { formatPixels } from '@/lib/seller-center/product-editor/format';

type SupplierMediaGalleryProps = {
  media: MediaItemFixture[];
};

const STATUS_ICON: Record<MediaItemFixture['rightsCheck'], typeof CircleCheck> =
  {
    VERIFIED: CircleCheck,
    PENDING_VERIFICATION: Clock,
    REJECTED: OctagonAlert,
  };

const STATUS_ICON_CLASS: Record<MediaItemFixture['rightsCheck'], string> = {
  VERIFIED: 'text-green-600',
  PENDING_VERIFICATION: 'text-muted-foreground',
  REJECTED: 'text-red-600',
};

const STATUS_LABEL: Record<MediaItemFixture['rightsCheck'], string> = {
  VERIFIED: 'Verified',
  PENDING_VERIFICATION: 'Pending verification',
  REJECTED: 'Rejected',
};

/**
 * The supplier's own photos, kept small on purpose (owner decision
 * 2026-08-17): this is provenance evidence, not a gallery a seller browses,
 * so it gets the same compact 44px treatment as the Basic Information
 * "Product media" thumbnail strip - never the larger per-image cards this
 * used to render. No reorder arrows, no "Make cover", no "Replace": nothing
 * here implies a seller decision (ADR-011).
 *
 * The full rights/storage detail (Verified/Rejected, dimensions, the
 * rejection reason) survives as a small corner icon plus a native `title`
 * tooltip rather than disappearing - a shrunk tile is still exact evidence,
 * not a decorative thumbnail.
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
    <ul className="flex list-none flex-wrap gap-1.5 p-0">
      {media.map((item) => {
        const StatusIcon = STATUS_ICON[item.rightsCheck];
        const tooltip = [
          item.label,
          STATUS_LABEL[item.rightsCheck],
          formatPixels(item.pixelWidth, item.pixelHeight),
          item.note,
        ]
          .filter((part): part is string => part !== null)
          .join(' — ');

        return (
          <li key={item.id} title={tooltip} className="relative">
            {item.sourceUrl === null ? (
              <span
                aria-hidden="true"
                className={`flex size-11 items-center justify-center overflow-hidden rounded-md border text-center text-[10px] leading-tight font-medium text-muted-foreground ${
                  item.rightsCheck === 'REJECTED'
                    ? 'border-2 border-red-600 bg-danger-surface/40'
                    : 'border-border bg-muted'
                }`}
              >
                {item.label}
              </span>
            ) : (
              <span
                className={`block size-11 overflow-hidden rounded-md border ${
                  item.rightsCheck === 'REJECTED'
                    ? 'border-2 border-red-600'
                    : 'border-border'
                } bg-muted`}
              >
                <Image
                  src={item.sourceUrl}
                  alt={item.altText}
                  width={44}
                  height={44}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </span>
            )}
            <StatusIcon
              aria-hidden="true"
              className={`absolute -top-1 -right-1 size-3.5 rounded-full bg-card ${STATUS_ICON_CLASS[item.rightsCheck]}`}
            />
            <span className="sr-only">{tooltip}</span>
          </li>
        );
      })}
    </ul>
  );
}
