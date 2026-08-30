'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';
import { toast } from 'sonner';
import {
  publishProductAction,
  unpublishProductAction,
} from '@/app/(portal)/listings/publish-actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import describePublishFailure from './publish-listing-messages';

type CatalogueRowActionsProps = {
  product: CatalogueProductFixture;
  editHref: string;
  onPauseListing: (id: string) => void;
  onArchive: (id: string) => void;
};

function announceUnbuilt(action: string, productName: string) {
  toast(`${action} isn't built yet for "${productName}".`, {
    description: 'This design preview has no catalogue backend.',
  });
}

/**
 * The row's Actions cell: `Edit`, then every other action behind one **More**
 * menu.
 *
 * Publish/Pause used to sit in the row as its own button beside `Edit`, which
 * made the Actions column the widest thing on a nine-column table and pushed it
 * off the right edge at anything below full zoom (owner report 2026-08-22). A
 * button per row is also the wrong weight for an action a seller takes once per
 * listing — the bulk bar above the table is where repeated publishing belongs.
 *
 * It owns the publish transition rather than the menu item doing so, because a
 * `DropdownMenuItem` unmounts the moment the menu closes on click: dispatching a
 * transition from a component being unmounted in the same commit is the exact
 * defect that shipped to production on 2026-08-19. This component stays mounted
 * while its own menu closes, so the action always has a live owner. It is also
 * why the toast, not a pending label, reports the outcome — nothing in the menu
 * is on screen by the time the server answers.
 *
 * **One row, one meaning of Pause.** A real row pauses through
 * `unpublishProductAction`, which genuinely takes it off the storefront. A
 * fixture row has no database row to contend with, so it pauses in memory and
 * says so. Both used to be offered at once on the same row — the real control as
 * a button, the preview one as a menu item — which read as two different pauses.
 * `productVersion` is the discriminator: it is the compare-and-set token the
 * publish action requires, and an illustrative fixture has none.
 */
export default function CatalogueRowActions({
  product,
  editHref,
  onPauseListing,
  onArchive,
}: CatalogueRowActionsProps) {
  const [isPending, startTransition] = useTransition();
  const isLive =
    product.status === 'LIVE' || product.status === 'LIVE_NEEDS_ATTENTION';
  const canViewLive = isLive && product.storefrontUrl !== null;
  const { productVersion } = product;
  const isPersisted = productVersion !== undefined;

  // Arrow consts, not declarations: airbnb's `react/jsx-no-bind` allows an
  // arrow function as a JSX prop and refuses a function declaration.
  const runPublish = () => {
    if (!isPersisted) {
      announceUnbuilt('Publish', product.name);
      return;
    }

    startTransition(async () => {
      const result = await publishProductAction({
        productId: product.sals3ProductId,
        expectedProductVersion: productVersion,
      });

      toast(
        result.ok
          ? `Published at /p/${result.slug} with ${result.offerCount} offer(s).`
          : describePublishFailure(result.reason, result.detail),
      );
    });
  };

  const runPause = () => {
    if (!isPersisted) {
      onPauseListing(product.id);
      return;
    }

    startTransition(async () => {
      const result = await unpublishProductAction({
        productId: product.sals3ProductId,
        expectedProductVersion: productVersion,
      });

      toast(
        result.ok
          ? 'Product paused. It is no longer on the storefront.'
          : describePublishFailure(result.reason),
      );
    });
  };

  return (
    <div className="flex items-center gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              disabled={isPending}
              aria-label={`More actions for ${product.name}`}
              className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {isPending ? 'Working…' : 'More'}
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          }
        />
        <DropdownMenuContent align="end">
          {/*
            Edit leads, because it is what this menu is opened for.

            It used to sit outside as its own link, which made the Actions
            column two controls wide on every row for one action a seller takes
            and one they mostly do not. Rendered as a `Link` rather than an item
            with an onClick so it keeps middle-click, open-in-new-tab and the
            status bar showing where it goes — a menu item that navigates by
            handler looks like a link and behaves like a button.
          */}
          <DropdownMenuItem render={<Link href={editHref} />}>
            Edit
          </DropdownMenuItem>
          {isLive ? (
            <DropdownMenuItem onClick={runPause}>
              Pause listing
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={runPublish}>
              Publish to storefront
            </DropdownMenuItem>
          )}
          {product.status === 'AUTO_PAUSED' ? (
            <DropdownMenuItem
              onClick={() => announceUnbuilt('Review & resume', product.name)}
            >
              Review &amp; resume
            </DropdownMenuItem>
          ) : null}
          {product.status === 'ARCHIVED' ? (
            <DropdownMenuItem
              onClick={() =>
                announceUnbuilt('Restore as new draft', product.name)
              }
            >
              Restore as new draft
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() =>
              announceUnbuilt('Duplicate as new draft', product.name)
            }
          >
            Duplicate as new draft
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canViewLive}
            onClick={() => {
              if (canViewLive) announceUnbuilt('View Live Page', product.name);
            }}
          >
            View Live Page
            {canViewLive ? null : ' (not live)'}
          </DropdownMenuItem>
          {product.status !== 'ARCHIVED' ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onArchive(product.id)}
            >
              Archive
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
