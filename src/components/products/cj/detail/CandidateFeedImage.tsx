import Image from 'next/image';
import { Package } from 'lucide-react';
import { IMAGE_COPY } from './copy';

type CandidateFeedImageProps = {
  /** Already host-checked by `imageUrl()`; null means no usable address. */
  address: string | null;
  /** Resolved by `displayName`, so this and the drawer title can never disagree. */
  name: string;
  /** `evidence.usableImageCount` when a snapshot exists, else null. */
  usableImageCount: number | null;
};

/**
 * The one product photo the database holds, at review size.
 *
 * ## No `sizes`, deliberately
 *
 * With no `sizes`, Next takes the `x` branch of `getWidths` and emits
 * `[width, width*2]` snapped to the nearest configured size - exactly `384w` and
 * `640w` for this 320px box. Adding `sizes` with any `vw` token takes the `w`
 * branch instead, `allSizes.filter(s => s >= deviceSizes[0] * smallestRatio)`,
 * whose smallest candidate is `640w` - so the CDN would be asked for 640px to
 * fill a 320px box. The wrong-width failure is *caused* by adding `sizes` here,
 * not prevented by it.
 *
 * ## No `priority`
 *
 * base-ui's `Tabs.Panel` defaults to `keepMounted = false`, so this element does
 * not exist until the reviewer opens the Supplier evidence tab. There is nothing
 * to preload, it is never the page's LCP element, and a preload would only
 * contend with the drawer's own payload.
 *
 * ## `aspect-square` and `object-contain`
 *
 * The box reserves its height before any byte arrives, so it cannot shift
 * content inside the drawer's scrolling panel - a shift there moves text under
 * an already-scrolled reader. `object-contain` rather than `cover` because
 * cropping a photo in a *review* tool can hide the thing being reviewed;
 * `bg-muted` letterboxes a non-square photo honestly.
 */
export default function CandidateFeedImage({
  address,
  name,
  usableImageCount,
}: CandidateFeedImageProps) {
  if (address === null) {
    return (
      <div className="flex w-80 max-w-full shrink-0 flex-col gap-2">
        <div
          aria-hidden="true"
          className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-border-strong bg-muted"
        >
          <Package className="size-8 text-ink-faint" />
        </div>
        <p className="text-sm font-medium">{IMAGE_COPY.noAddressTitle}</p>
        <p className="text-xs text-ink-subtle">
          {IMAGE_COPY.noAddress}
          {usableImageCount !== null && usableImageCount > 0
            ? ` ${IMAGE_COPY.countedButUnstored(usableImageCount)}`
            : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="aspect-square w-80 max-w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
      <Image
        src={address}
        alt={`Supplier listing photo for ${name}`}
        width={320}
        height={320}
        loading="lazy"
        className="size-full object-contain"
      />
    </div>
  );
}
