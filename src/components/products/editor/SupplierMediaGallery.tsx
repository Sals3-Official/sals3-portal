'use client';

import { useState } from 'react';
import Image from 'next/image';
import { CircleCheck, Clock, GripVertical, OctagonAlert } from 'lucide-react';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import { formatPixels } from '@/lib/seller-center/product-editor/format';

type SupplierMediaGalleryProps = {
  media: MediaItemFixture[];
  /**
   * Commits a new order for the supplier's photos. Omitted wherever no real
   * product exists to save one against, or where the panel is showing feed
   * addresses with no provenance row behind them — in both cases the tiles are
   * simply not draggable, rather than draggable and forgetful.
   */
  onReorder?: (mediaIds: string[]) => void;
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
 * used to render.
 *
 * ## Arrangeable here, and only here (owner decision 2026-08-28)
 *
 * ADR-011 §3 called this set read-only and this component honoured it
 * literally: no reorder, no cover, no replace. The amendment of 2026-08-28
 * changed one of those three. The supplier's photographs are slides a buyer
 * scrolls, so the seller decides their order — but they are still the
 * supplier's, so they are still never deleted and never replaced here.
 *
 * The drag lives in *this* panel rather than in Product media, which is the
 * owner's own correction after seeing supplier tiles appear in a grid whose
 * counter reads "N of 12 photos" and counts only uploads. Product media is what
 * the seller uploaded; this is what the supplier sent; each is arranged where it
 * lives.
 *
 * What a reorder writes is `product_media_sources.position` and nothing else -
 * `source_url`, `checksum`, `observed_at`, `rights_basis` and `review_state`
 * are untouched, which is the whole reason moving a photograph is an editorial
 * act about the evidence rather than a change to it. The rights/storage icon
 * and its tooltip stay exactly as they were, because arranging evidence does
 * not make it more or less verified.
 *
 * The full rights/storage detail (Verified/Rejected, dimensions, the
 * rejection reason) survives as a small corner icon plus a native `title`
 * tooltip rather than disappearing - a shrunk tile is still exact evidence,
 * not a decorative thumbnail.
 */
export default function SupplierMediaGallery({
  media,
  onReorder,
}: SupplierMediaGalleryProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const canArrange = onReorder !== undefined && media.length > 1;

  /**
   * Moves the dragged tile to the position of the tile the cursor entered, on
   * `dragenter` rather than on drop, so the strip reorders under the cursor and
   * the seller watches the result form instead of guessing where it will land.
   */
  const handleDragEnter = (overId: string) => {
    if (draggingId === null || draggingId === overId) return;

    const from = media.findIndex((item) => item.id === draggingId);
    const to = media.findIndex((item) => item.id === overId);

    if (from === -1 || to === -1) return;

    const next = media.map((item) => item.id);
    const [moved] = next.splice(from, 1);

    if (moved === undefined) return;

    next.splice(to, 0, moved);
    onReorder?.(next);
  };

  if (media.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No supplier photo address is recorded for this product yet.
      </p>
    );
  }

  return (
    <>
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
            <li
              key={item.id}
              title={tooltip}
              className={`relative transition-opacity ${
                draggingId === item.id ? 'opacity-40' : ''
              }`}
              onDragEnter={
                canArrange ? () => handleDragEnter(item.id) : undefined
              }
              onDragOver={
                canArrange
                  ? (event) => {
                      // Without this the drop target is never valid and the drag
                      // ends as a cancel, which reads as "nothing happened".
                      event.preventDefault();
                    }
                  : undefined
              }
            >
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
              {canArrange ? (
                /*
                 * A `<span role="button">`, not a `<button>`: a bare
                 * `<button draggable="true">` never fires `dragstart` in
                 * Chromium, the same finding that shaped the Variant Matrix grip
                 * (2026-08-22) and the Product media grip. The accepted cost is
                 * the same one recorded there — native drag fires from neither
                 * keyboard nor touch, so this order cannot be changed on a
                 * touchscreen.
                 */
                <span
                  role="button"
                  tabIndex={-1}
                  draggable
                  aria-hidden="true"
                  title="Drag to reorder"
                  onDragStart={() => setDraggingId(item.id)}
                  onDragEnd={() => setDraggingId(null)}
                  className="absolute right-0 -bottom-1 cursor-grab rounded bg-black/45 text-white active:cursor-grabbing"
                >
                  <GripVertical className="size-3" />
                </span>
              ) : null}
              <span className="sr-only">{tooltip}</span>
            </li>
          );
        })}
      </ul>
      {canArrange ? (
        <p className="mt-1.5 mb-0 text-[11px] text-ink-subtle">
          Drag a photo by its grip to reorder how buyers see them. Supplier
          photos are never deleted here.
        </p>
      ) : null}
    </>
  );
}
