import { useRef, useState } from 'react';
import Image from 'next/image';
import { Star, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';

type ProductPhotoManagerProps = {
  /** The seller's own uploads only - never the supplier's photos. */
  media: MediaItemFixture[];
  /** Omitted for fixture/design-preview mode - no real product to attach a photo to. */
  onUpload?: (files: FileList) => void;
  onDelete?: (id: string) => void;
  onMakeCover: (id: string) => void;
  isUploading: boolean;
  /** `null` while a specific tile's delete request is in flight. */
  deletingId: string | null;
  maxPhotos: number;
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
  onHoverStart: (id: string) => void;
  onHoverEnd: (id: string) => void;
  onDelete?: (id: string) => void;
  onMakeCover: (id: string) => void;
};

function PhotoTile({
  item,
  sizePx,
  isCoverTile,
  isHovered,
  isDeleting,
  onHoverStart,
  onHoverEnd,
  onDelete,
  onMakeCover,
}: PhotoTileProps) {
  return (
    <li
      className="relative shrink-0 list-none"
      style={{ width: sizePx, height: sizePx }}
      onMouseEnter={() => onHoverStart(item.id)}
      onMouseLeave={() => onHoverEnd(item.id)}
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
          {onDelete === undefined ? null : (
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
 * The seller's own product photos, managed directly in Basic Information
 * (owner decision 2026-08-17) - a real upload/delete/cover grid, not a
 * passive summary pointing at a separate Media section, which no longer
 * exists (its whole reason to exist moved here).
 *
 * The cover photo renders larger and first, the rest follow at a smaller,
 * uniform size, with one dashed "Upload" tile at the end while the product
 * is still under `maxPhotos`. Delete and "Set as cover" surface as small
 * icon buttons in each tile's corner rather than a always-on toolbar row -
 * legible without turning every thumbnail into a control panel.
 */
export default function ProductPhotoManager({
  media,
  onUpload,
  onDelete,
  onMakeCover,
  isUploading,
  deletingId,
  maxPhotos,
}: ProductPhotoManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const cover = media.find((item) => item.isCover) ?? media[0];
  const rest = media.filter((item) => item.id !== cover?.id);
  const canAddMore = media.length < maxPhotos;

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
            onHoverStart={setHoveredId}
            onHoverEnd={handleHoverEnd}
            onDelete={onDelete}
            onMakeCover={onMakeCover}
          />
        )}
        {rest.map((item) => (
          <PhotoTile
            key={item.id}
            item={item}
            sizePx={TILE_SIZE_PX}
            isCoverTile={false}
            isHovered={hoveredId === item.id}
            isDeleting={deletingId === item.id}
            onHoverStart={setHoveredId}
            onHoverEnd={handleHoverEnd}
            onDelete={onDelete}
            onMakeCover={onMakeCover}
          />
        ))}
        {uploadTile}
      </ul>
    </div>
  );
}
