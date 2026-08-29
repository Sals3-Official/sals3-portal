'use client';

import Image from 'next/image';
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  MoveUp,
  OctagonAlert,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import { formatPixels } from '@/lib/seller-center/product-editor/format';

type SupplierMediaGalleryProps = {
  media: MediaItemFixture[];
  /**
   * Commits a new order for the supplier's photos. Omitted wherever no real
   * product exists to save one against, or where the panel is showing feed
   * addresses with no provenance row behind them — in both cases the tiles
   * carry no controls, rather than controls that are silently forgetful.
   */
  onReorder?: (mediaIds: string[]) => void;
  /**
   * How many product-level photos the seller has uploaded of their own.
   *
   * This panel cannot answer "which photo is the cover" without it. The cover
   * is position 0 of the *whole* gallery and `ProductEditorWorkspace` composes
   * that as `[...seller uploads, ...supplier photos]`, so the supplier's first
   * photograph leads only while this is `0`. Badging it `Cover` without
   * checking would be the panel asserting something the storefront contradicts
   * the moment a seller uploads anything.
   */
  sellerGalleryCount: number;
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
 * The supplier's own photos: which one a buyer meets first, and in what order
 * they see the rest.
 *
 * ## Arrangeable here, and only here (owner decision 2026-08-28)
 *
 * ADR-011 §3 called the supplier set read-only and this component honoured it
 * literally: no reorder, no cover, no replace. The amendment of 2026-08-28
 * changed one of those three. The supplier's photographs are slides a buyer
 * scrolls, so the seller decides their order — but they are still the
 * supplier's, so they are still never deleted and never replaced here.
 *
 * The controls live in *this* panel rather than in Product media, which is the
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
 * ## Buttons, not a drag grip (owner decision 2026-08-30)
 *
 * This panel used to be 44px tiles carrying a single drag grip, and the owner
 * reported both as unusable: *"lakihan mo nga at masyadong maliit tapos yung
 * drag button ang hirap sa user experience"*. The size was the smaller half of
 * the problem. The grip was a `<span draggable>` firing native HTML5 drag,
 * which fires from **neither keyboard nor touch** — a limitation this
 * repository had already accepted twice in writing (the Variant Matrix grip,
 * 2026-08-22, and Product media's). So on a tablet the supplier's order was not
 * merely awkward to change, it could not be changed at all, and the one
 * decision that matters most — which photograph a buyer meets first — was
 * reachable only with a mouse.
 *
 * Every control here is now a real `<button>`: `Set as cover` sends a photo to
 * the front, and the two chevrons move it one place. That reaches keyboard and
 * touch, and it is the same single write the drag issued.
 *
 * ## Why a cover control is not a new power
 *
 * A named `Set as cover` button looks like more authority than ADR-011's
 * amendment granted. It is not. The cover is position 0 of the whole gallery
 * and this panel already wrote position 0 whenever the seller had uploaded
 * nothing — dragging a supplier photo to the front *was* choosing the cover,
 * unlabelled. `reorder-product-media.ts` says so in its own words: "making
 * something the cover means moving it to the front". This names what the drag
 * already did; it does not widen it. Deleting and replacing stay refused, here
 * and in `delete-seller-media.ts`'s own `WHERE`.
 *
 * ## The label follows who actually holds position 0
 *
 * With `sellerGalleryCount > 0` a seller upload holds the cover and nothing in
 * this panel can reach it, because the composed order is
 * `[...seller uploads, ...supplier photos]`. Offering `Set as cover` there
 * would be a button that cannot do what it says, so it reads `Move to front`
 * and the panel states plainly who leads. Same write, honest name.
 */
export default function SupplierMediaGallery({
  media,
  onReorder,
  sellerGalleryCount,
}: SupplierMediaGalleryProps) {
  const canArrange = onReorder !== undefined && media.length > 1;
  /**
   * Whether the supplier's first photograph is the product's cover.
   *
   * Read from the seller's own upload count rather than from any tile's
   * `isCover`: `editorSupplierMedia` sets that flag to `index === 0` for this
   * panel's own list, which is true of the supplier set and says nothing about
   * the gallery the storefront actually orders.
   */
  const supplierLeads = sellerGalleryCount === 0;

  /**
   * The tile's own frame. Rejected rights outrank the cover ring: a photo the
   * review refused is the more urgent thing to see, and it cannot be published
   * anyway.
   */
  const frameClass = (item: MediaItemFixture, isCoverTile: boolean): string => {
    if (item.rightsCheck === 'REJECTED') return 'border-2 border-red-600';
    if (isCoverTile) return 'border-2 border-primary';

    return 'border-border';
  };

  const moveTo = (from: number, to: number) => {
    if (onReorder === undefined) return;
    if (to < 0 || to >= media.length || to === from) return;

    const next = media.map((item) => item.id);
    const [moved] = next.splice(from, 1);

    if (moved === undefined) return;

    next.splice(to, 0, moved);
    onReorder(next);
  };

  /**
   * The strip under each photo. The leading tile states what it already is;
   * every other tile carries the one control that matters, named for what it
   * can actually reach from here.
   */
  const tileFooter = (
    item: MediaItemFixture,
    index: number,
    isLeading: boolean,
  ) => {
    if (!canArrange) return null;

    if (isLeading) {
      return (
        <p className="m-0 border-t border-border px-2.5 py-2.5 text-center text-xs text-ink-subtle">
          {supplierLeads
            ? 'Buyers see this first'
            : 'First of the supplier set'}
        </p>
      );
    }

    return (
      <Button
        type="button"
        variant="ghost"
        aria-label={
          supplierLeads
            ? `Set ${item.label} as cover`
            : `Move ${item.label} to the front of the supplier photos`
        }
        className="h-9 w-full rounded-none rounded-b-lg border-t border-border text-xs font-semibold"
        onClick={() => moveTo(index, 0)}
      >
        {supplierLeads ? (
          <Star aria-hidden="true" />
        ) : (
          <MoveUp aria-hidden="true" />
        )}
        {supplierLeads ? 'Set as cover' : 'Move to front'}
      </Button>
    );
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
      {supplierLeads ? null : (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-border-strong bg-accent px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
          <Star
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-accent-foreground"
          />
          <span>
            <span className="font-semibold text-accent-foreground">
              Your own photo is the cover.
            </span>{' '}
            Buyers see it in the storefront thumbnail, and these supplier photos
            follow it in the gallery. Change the cover in Product media.
          </span>
        </p>
      )}

      {/*
       * Column counts chosen so a tile lands in a 120-180px band at every
       * container width, rather than a fixed count that reads as one size on a
       * narrow rail and another entirely on a wide one. Measured in the real
       * editor: the section's `@container` is 1109px with the nav rail
       * expanded, so six columns give ~168px — comfortably larger than the
       * 44px this panel used to render, and deliberately not larger than
       * Product media's own 152px cover tile, which still leads the gallery.
       */}
      <ul className="grid list-none grid-cols-2 gap-3 p-0 @sm:grid-cols-3 @lg:grid-cols-4 @3xl:grid-cols-5 @5xl:grid-cols-6">
        {media.map((item, index) => {
          const StatusIcon = STATUS_ICON[item.rightsCheck];
          const tooltip = [
            item.label,
            STATUS_LABEL[item.rightsCheck],
            formatPixels(item.pixelWidth, item.pixelHeight),
            item.note,
          ]
            .filter((part): part is string => part !== null)
            .join(' — ');
          const leads = index === 0;

          return (
            <li
              key={item.id}
              className={`overflow-hidden rounded-lg border bg-card ${frameClass(
                item,
                leads && supplierLeads,
              )}`}
            >
              <div
                title={tooltip}
                className={`relative flex aspect-square items-center justify-center ${
                  item.rightsCheck === 'REJECTED'
                    ? 'bg-danger-surface/40'
                    : 'bg-muted'
                }`}
              >
                {item.sourceUrl === null ? (
                  <span
                    aria-hidden="true"
                    className="px-2 text-center text-xs leading-tight font-medium text-muted-foreground"
                  >
                    {item.label}
                  </span>
                ) : (
                  <Image
                    src={item.sourceUrl}
                    alt={item.altText}
                    width={240}
                    height={240}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                )}

                {leads ? (
                  <span
                    className={`absolute top-2 left-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      supplierLeads
                        ? 'bg-sidebar text-sidebar-foreground'
                        : 'border border-border-strong bg-muted text-accent-foreground'
                    }`}
                  >
                    {supplierLeads ? 'Cover' : '1st supplier'}
                  </span>
                ) : null}

                <StatusIcon
                  aria-hidden="true"
                  className={`absolute top-2 right-2 size-4 rounded-full bg-card ${STATUS_ICON_CLASS[item.rightsCheck]}`}
                />

                {canArrange ? (
                  <div className="absolute bottom-2 left-2 flex gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Move ${item.label} earlier`}
                      title="Move earlier"
                      disabled={index === 0}
                      onClick={() => moveTo(index, index - 1)}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Move ${item.label} later`}
                      title="Move later"
                      disabled={index === media.length - 1}
                      onClick={() => moveTo(index, index + 1)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}

                <span className="sr-only">{tooltip}</span>
              </div>

              {tileFooter(item, index, leads)}
            </li>
          );
        })}
      </ul>

      {canArrange ? (
        <p className="mt-2.5 mb-0 text-[11px] text-ink-subtle">
          {supplierLeads
            ? 'The first photo is the cover — the thumbnail buyers see. Supplier photos are never deleted here.'
            : 'Reordering changes what buyers scroll through after your own photos. Supplier photos are never deleted here.'}
        </p>
      ) : null}
    </>
  );
}
