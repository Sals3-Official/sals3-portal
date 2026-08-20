'use client';

import { CircleCheck } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * What a seller sees the moment a listing goes live.
 *
 * Publication used to report itself in a toast, which is the one place this
 * outcome does not belong: it is the end of a long task, it names a URL the
 * seller may want to read, and it is the moment they most likely want to leave
 * for the catalogue. A toast dismisses itself while they are still reading it,
 * and offers nowhere to go.
 *
 * So it is a dialog with the two things a finished task needs — confirmation of
 * what happened, and the way out. Nothing is destructive here and nothing is
 * being asked, so it is a `Dialog` rather than an `AlertDialog`: Escape, the
 * backdrop, and the close button all dismiss it, and staying on the listing is
 * a legitimate choice rather than a cancellation.
 *
 * ## The frosted backdrop
 *
 * `overlayClassName` exists on `DialogContent` for exactly this: a heavier
 * frost, so the editor visibly recedes and the panel reads as lifted off it. The
 * panel itself stays a near-opaque surface rather than glass — text on live
 * blur cannot hold a contrast ratio, because whatever scrolls behind it decides
 * the ratio. The glass is the air around the card, not the card.
 */

export type PublishSuccessDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  /** The storefront path, as `publishProduct` returned it. */
  slug: string;
  offerCount: number;
  /** Where the Product Catalogue lives, so this component never guesses. */
  catalogueHref: string;
};

export default function PublishSuccessDialog({
  open,
  onOpenChange,
  productName,
  slug,
  offerCount,
  catalogueHref,
}: PublishSuccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Frost plus a warm wash, so the dialog lifts on a light editor and
        // still reads on a dark one. `supports-backdrop-filter` gates the blur;
        // the tint alone is enough where it is unsupported.
        overlayClassName="bg-slate-900/25 supports-backdrop-filter:backdrop-blur-md"
        className="max-w-[calc(100%-2rem)] border border-white/50 bg-card/95 shadow-2xl ring-foreground/5 sm:max-w-md"
      >
        <DialogHeader>
          <span className="flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <CircleCheck aria-hidden="true" className="size-5" />
          </span>
          <DialogTitle className="font-display text-base">
            Published to the storefront
          </DialogTitle>
          <DialogDescription>
            {productName} is live. Buyers can find it now.
          </DialogDescription>
        </DialogHeader>

        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-muted-foreground">Storefront path</dt>
          {/* Text, not a link: the buyer-facing site is a separate origin this
              screen has no confirmed address for, and a link that might 404 is
              worse than a path a seller can read. */}
          <dd className="m-0 truncate font-mono text-xs">/p/{slug}</dd>
          <dt className="text-muted-foreground">Offers live</dt>
          <dd className="m-0 tabular-nums">{offerCount}</dd>
        </dl>

        <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/40 p-4 sm:flex-row sm:justify-end">
          <DialogClose
            render={<Button type="button" variant="ghost" size="lg" />}
          >
            Stay on this listing
          </DialogClose>
          <LinkButton href={catalogueHref}>Go to Product Catalogue</LinkButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
