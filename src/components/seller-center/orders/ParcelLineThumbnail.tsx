import Image from 'next/image';

type ParcelLineThumbnailProps = {
  /** The address frozen onto the order line at acceptance. */
  imageUrl: string | null;
  /** The line title, used as the accessible name. */
  title: string;
  /** Rendered size in pixels. The list card uses 44, the detail card 56. */
  size: number;
};

/**
 * The photo of an ordered item, as it was when the buyer bought it.
 *
 * One component for both order surfaces on purpose. Each card previously drew
 * its own `bg-muted` square and **never rendered the photo at all** — the
 * address travelled from `sals3_order_lines.image_url` through the read model
 * and into `ParcelLine.imageUrl`, and both cards dropped it on the floor. That
 * survived because the fixture had no real photos either, so nothing looked
 * wrong until the rows became real.
 *
 * Two copies of the placeholder is how that happened, so there is one copy now.
 *
 * ## Why `next/image` here is safe for both hosts
 *
 * The portal runs a custom loader (`lib/images/cj-image-loader.ts`) because
 * Vercel's metered optimizer once answered `402` to every image in the portal.
 * That loader rewrites CJ CDN addresses to use CJ's own resizing and **returns
 * anything else untouched**, so a seller-uploaded photo on Cloudflare R2 passes
 * through unchanged. Both are addresses this column legitimately holds.
 *
 * ## Why the frozen address, not a live lookup
 *
 * ADR-007: the ordered item is frozen at acceptance. Re-resolving the photo
 * from the live listing would show a seller their *current* picture against an
 * old order — the exact substitution that requirement exists to prevent. The
 * cost is that an address CJ later removes will 404, and the alternative is
 * showing something the buyer never saw.
 */
export default function ParcelLineThumbnail({
  imageUrl,
  title,
  size,
}: ParcelLineThumbnailProps) {
  return (
    <span
      className="relative flex flex-none items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-[9px] leading-tight text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {imageUrl === null ? (
        // Not decorative: "this line has no photo" is a fact a seller packing
        // or querying an order needs, and an empty grey square says nothing.
        'No photo'
      ) : (
        <Image
          src={imageUrl}
          alt={title}
          width={size}
          height={size}
          sizes={`${size}px`}
          className="size-full object-contain"
        />
      )}
    </span>
  );
}
