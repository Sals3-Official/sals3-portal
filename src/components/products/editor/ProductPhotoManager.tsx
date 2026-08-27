import { useRef, useState } from 'react';
import Image from 'next/image';
import { GripVertical, Star, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import { cn } from '@/lib/utils';

type ProductPhotoManagerProps = {
  /**
   * The product's whole gallery, in order — seller uploads and supplier
   * originals alike (ADR-011 amendment 2026-08-28). The first entry is the
   * cover.
   */
  media: MediaItemFixture[];
  /** Omitted for fixture/design-preview mode - no real product to attach a photo to. */
  onUpload?: (files: FileList) => void;
  onDelete?: (id: string) => void;
  onMakeCover: (id: string) => void;
  /**
   * Commits a whole new order. Omitted where no real product exists to save an
   * arrangement against, in which case tiles are not draggable at all rather
   * than draggable and silently forgetful.
   */
  onReorder?: (mediaIds: string[]) => void;
  isUploading: boolean;
  /** `null` while a specific tile's delete request is in flight. */
  deletingId: string | null;
  /** Bounds the seller's own uploads. Supplier photos do not consume it. */
  maxPhotos: number;
  /**
   * How many leading photos a buyer is actually served
   * (`storefront/read-model.ts`'s `MAX_DETAIL_IMAGES`). Tiles past this are
   * marked, because a gallery can now hold more rows than the storefront shows
   * and the seller is the one deciding which ones make the cut.
   */
  buyerVisibleCount: number;
};

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp';
const TILE_SIZE_PX = 96;
const COVER_TILE_SIZE_PX = 152;

type PhotoTileProps = {
  item: MediaItemFixture;
  sizePx: number;
  isCoverTile: boolean;
  isHovered: boolean;
  isDeleting: boolean;
  /** Past the storefront's own gallery limit, so a buyer never reaches it. */
  isBeyondBuyerLimit: boolean;
  onHoverStart: (id: string) => void;
  onHoverEnd: (id: string) => void;
  onDelete?: (id: string) => void;
  onMakeCover: (id: string) => void;
  /** Absent when arranging is unavailable — then no grip is rendered. */
  drag?: {
    isDragging: boolean;
    onDragStart: (id: string) => void;
    onDragEnter: (id: string) => void;
    onDragEnd: () => void;
  };
};

function PhotoTile({
  item,
  sizePx,
  isCoverTile,
  isHovered,
  isDeleting,
  isBeyondBuyerLimit,
  onHoverStart,
  onHoverEnd,
  onDelete,
  onMakeCover,
  drag,
}: PhotoTileProps) {
  return (
    <li
      className={cn(
        'relative shrink-0 list-none transition-opacity',
        drag?.isDragging === true && 'opacity-40',
        isBeyondBuyerLimit && 'opacity-70',
      )}
      style={{ width: sizePx, height: sizePx }}
      onMouseEnter={() => onHoverStart(item.id)}
      onMouseLeave={() => onHoverEnd(item.id)}
      onDragEnter={
        drag === undefined ? undefined : () => drag.onDragEnter(item.id)
      }
      onDragOver={
        drag === undefined
          ? undefined
          : (event) => {
              // Without this the drop target is never valid and the drag ends
              // as a cancel, which reads to the seller as "nothing happened".
              event.preventDefault();
            }
      }
    >
      <span className="block size-full overflow-hidden rounded-lg border border-border bg-muted">
        {item.sourceUrl === null ? (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center text-center text-xs text-muted-foreground"
          >
            {item.label}
          </span>
        ) : (
          <Image
            src={item.sourceUrl}
            alt={item.altText}
            width={sizePx}
            height={sizePx}
            loading="lazy"
            className="size-full object-cover"
          />
        )}
      </span>

      {isCoverTile ? (
        <span className="absolute top-1.5 left-1.5 rounded-full bg-sidebar px-2 py-0.5 text-[11px] font-semibold text-sidebar-foreground">
          Cover
        </span>
      ) : null}

      {drag === undefined ? null : (
        /*
         * A `<span role="button">`, not a `<button>`: a spike against a bare
         * `<button draggable="true">` never fired `dragstart` in Chromium while
         * identical markup as a `<span>` did — the same finding that made the
         * Variant Matrix's reorder grip a span (2026-08-22). The accepted cost
         * is the same one recorded there: native drag fires from neither
         * keyboard nor touch, so the arrangement cannot be changed on a
         * touchscreen, and "Set as cover" below is the non-drag path to the one
         * reorder that matters most.
         */
        <span
          role="button"
          tabIndex={-1}
          draggable
          aria-hidden="true"
          title="Drag to reorder"
          onDragStart={() => drag.onDragStart(item.id)}
          onDragEnd={drag.onDragEnd}
          className="absolute right-1 bottom-1 cursor-grab rounded bg-black/45 p-0.5 text-white active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </span>
      )}

      {isHovered || isDeleting ? (
        <div className="absolute inset-0 flex items-start justify-end gap-1 rounded-lg bg-black/35 p-1.5">
          {isCoverTile ? null : (
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={`Set ${item.label} as cover`}
              disabled={isDeleting}
              onClick={() => onMakeCover(item.id)}
            >
              <Star aria-hidden="true" className="size-3.5" />
            </Button>
          )}
          {onDelete === undefined ||
          item.sourceType !== 'SELLER_UPLOAD' ? null : (
            <Button
              type="button"
              variant="destructive"
              size="icon-sm"
              aria-label={`Delete ${item.label}`}
              disabled={isDeleting}
              onClick={() => onDelete(item.id)}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The product's gallery, managed directly in Basic Information (owner decision
 * 2026-08-17) - a real upload/delete/arrange grid, not a passive summary
 * pointing at a separate Media section, which no longer exists (its whole
 * reason to exist moved here).
 *
 * The cover photo renders larger and first, the rest follow at a smaller,
 * uniform size, with one dashed "Upload" tile at the end while the seller is
 * still under `maxPhotos`. Delete and "Set as cover" surface as small icon
 * buttons in each tile's corner rather than an always-on toolbar row - legible
 * without turning every thumbnail into a control panel.
 *
 * ## Supplier photos are tiles here too (ADR-011 amendment 2026-08-28)
 *
 * They can be dragged and they can be made the cover, because they are slides a
 * buyer scrolls and the seller decides what a buyer sees first. What they cannot
 * be is deleted: the delete button renders only for a `SELLER_UPLOAD` tile, and
 * `delete-seller-media.ts` enforces the same rule inside its `WHERE` clause - so
 * the UI is the courtesy and the query is the guarantee.
 *
 * ## The cover is the first tile
 *
 * There is no separate cover flag on the wire or in the database. "Set as cover"
 * moves a photo to the front, which is the same write as any other reorder - one
 * fact, so nothing can disagree with it. It stays a *button* rather than becoming
 * drag-only, because native drag fires from neither keyboard nor touch: without
 * it, the one arrangement decision that matters most would be mouse-only.
 *
 * ## `maxPhotos` counts the seller's own uploads, not tiles
 *
 * A supplier photo does not consume the upload budget - it was never uploaded.
 * So the Upload affordance is offered against the count of `SELLER_UPLOAD`
 * entries, which is also the number the panel's own "N of 12" counter shows.
 */
export default function ProductPhotoManager({
  media,
  onUpload,
  onDelete,
  onMakeCover,
  onReorder,
  isUploading,
  deletingId,
  maxPhotos,
  buyerVisibleCount,
}: ProductPhotoManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // The gallery's own order is the source of truth: the cover is the first
  // entry, not a tile carrying a flag. `isCover` on the fixture is derived from
  // that same position, so reading the order here means the two cannot drift.
  const cover = media[0];
  const rest = media.slice(1);
  const sellerPhotoCount = media.filter(
    (item) => item.sourceType === 'SELLER_UPLOAD',
  ).length;
  const canAddMore = sellerPhotoCount < maxPhotos;
  const canArrange = onReorder !== undefined && media.length > 1;
  const beyondLimit = media.length - buyerVisibleCount;

  /**
   * Moves the dragged tile to the position of the tile the cursor entered.
   *
   * On `dragenter` rather than on drop, so the grid reorders under the cursor
   * and the seller watches the result form instead of guessing where the photo
   * will land. The caller persists each intermediate order, which is acceptable
   * because `reorderProductMedia` is one transaction over a couple of dozen rows
   * and the last write is the one that stands.
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

  const dragFor = (item: MediaItemFixture) =>
    canArrange
      ? {
          isDragging: draggingId === item.id,
          onDragStart: setDraggingId,
          onDragEnter: handleDragEnter,
          onDragEnd: () => setDraggingId(null),
        }
      : undefined;

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const { files } = input;

    if (files !== null && files.length > 0) onUpload?.(files);

    // Reset so selecting the exact same file again still fires `onChange`.
    input.value = '';
  };

  const handleHoverEnd = (id: string) =>
    setHoveredId((current) => (current === id ? null : current));

  const uploadTile = canAddMore ? (
    <button
      type="button"
      disabled={onUpload === undefined || isUploading}
      title={
        onUpload === undefined
          ? 'Uploading a photo needs a real product to attach it to'
          : undefined
      }
      onClick={() => fileInputRef.current?.click()}
      className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border-strong text-muted-foreground transition-colors enabled:cursor-pointer enabled:hover:border-primary enabled:hover:text-primary disabled:opacity-50"
    >
      <Upload aria-hidden="true" className="size-5" />
      <span className="text-[11px] leading-none font-medium">
        {isUploading ? 'Uploading…' : 'Upload'}
      </span>
    </button>
  ) : null;

  return (
    <div className="flex flex-col gap-2.5">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        hidden
        onChange={handleFilesSelected}
      />

      <ul className="flex flex-wrap items-start gap-2 p-0">
        {cover === undefined ? null : (
          <PhotoTile
            item={cover}
            sizePx={COVER_TILE_SIZE_PX}
            isCoverTile
            isHovered={hoveredId === cover.id}
            isDeleting={deletingId === cover.id}
            isBeyondBuyerLimit={false}
            onHoverStart={setHoveredId}
            onHoverEnd={handleHoverEnd}
            onDelete={onDelete}
            onMakeCover={onMakeCover}
            drag={dragFor(cover)}
          />
        )}
        {rest.map((item, index) => (
          <PhotoTile
            key={item.id}
            item={item}
            sizePx={TILE_SIZE_PX}
            isCoverTile={false}
            isHovered={hoveredId === item.id}
            isDeleting={deletingId === item.id}
            // `index + 1` because `rest` starts after the cover tile.
            isBeyondBuyerLimit={index + 1 >= buyerVisibleCount}
            onHoverStart={setHoveredId}
            onHoverEnd={handleHoverEnd}
            onDelete={onDelete}
            onMakeCover={onMakeCover}
            drag={dragFor(item)}
          />
        ))}
        {uploadTile}
      </ul>

      {beyondLimit > 0 ? (
        <p className="m-0 text-xs text-muted-foreground">
          Buyers see the first {buyerVisibleCount}. The{' '}
          {beyondLimit === 1
            ? 'faded photo is'
            : `${beyondLimit} faded photos are`}{' '}
          stored but never shown &mdash; drag one forward to change that.
        </p>
      ) : null}

      {canArrange ? (
        <p className="m-0 text-xs text-muted-foreground">
          Drag a photo by its grip to reorder. The first one is the cover.
        </p>
      ) : null}
    </div>
  );
}
