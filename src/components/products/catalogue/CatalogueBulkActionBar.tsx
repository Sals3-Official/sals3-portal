'use client';

import { useState, useTransition } from 'react';
import { ChevronDown, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  publishProductAction,
  type PublishActionResult,
} from '@/app/(portal)/listings/publish-actions';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import describePublishFailure from './publish-listing-messages';
import CataloguePublishResults, {
  type PublishOutcome,
} from './CataloguePublishResults';

type CatalogueBulkActionBarProps = {
  /**
   * The selected rows themselves, not just how many.
   *
   * Publishing needs each product's id and the version its row was read at —
   * `publishProductAction` compare-and-sets on that version, so a listing
   * someone else edited while this screen sat open is refused rather than
   * overwritten. A count could not carry either.
   */
  selectedProducts: CatalogueProductFixture[];
  /**
   * Whether this tab is one where publishing means anything.
   *
   * `false` on Live and Live · Needs Attention: everything there is already on
   * the storefront, so a Publish button is an action with no subject. Hidden
   * rather than disabled — a greyed control invites a seller to work out what
   * would enable it, and nothing on those tabs ever would.
   */
  canPublish: boolean;
  onBulkPause: () => void;
  onBulkArchive: () => void;
  /** Called after a run that published at least one listing, to refetch. */
  onPublished: () => void;
};

/**
 * Selection state is real (`ProductCatalogueWorkspace` tracks it and this
 * bar's disabled state reflects it honestly). Bulk pause is a safe action
 * a seller can always take, so it really updates the in-memory fixture
 * state (preview-only, not persisted). Bulk archive is destructive/
 * consequential, so it requires explicit confirmation - matching
 * `EditorActionBar`'s convention - and stays clearly preview-only until a
 * real catalogue backend exists. Price editing and export remain
 * unbuilt and say so rather than faking success.
 *
 * ## Publish is the exception, and reaches a real server
 *
 * `publishProductAction` exists, the row's action menu already calls it one
 * product at a time, and getting a batch of drafts live was the reason to open
 * this screen at all. So this is the one action here that is not a preview.
 *
 * It runs **sequentially**, not `Promise.all`. Publishing writes revisions,
 * offers and slugs; the action is rate limited to 30 calls a minute per seller
 * and each call does real work upstream. Firing twenty at once would spend that
 * budget in a burst and turn a queue problem into `rate_limited` refusals that
 * look like product problems. One at a time is slower and legible.
 *
 * Every outcome is kept and shown — see `CataloguePublishResults` for why a
 * toast is the wrong shape for eighteen possible refusals.
 */
export default function CatalogueBulkActionBar({
  selectedProducts,
  canPublish,
  onBulkPause,
  onBulkArchive,
  onPublished,
}: CatalogueBulkActionBarProps) {
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [outcomes, setOutcomes] = useState<PublishOutcome[]>([]);
  const [isPublishing, startPublish] = useTransition();
  const selectedCount = selectedProducts.length;
  const disabled = selectedCount === 0;
  // A row with no version is an illustrative fixture, not a stored product.
  // `publishProductAction` compare-and-sets on that version and there is
  // nothing to set against, so those are excluded from the count rather than
  // sent and refused as `invalid_input`.
  const publishable = selectedProducts.filter(
    (product) =>
      product.productVersion !== undefined &&
      // Already on the storefront. Selecting a mix on All and pressing Publish
      // should get the drafts live and leave the rest alone, rather than
      // re-running a publish that has nothing to change.
      product.status !== 'LIVE' &&
      product.status !== 'LIVE_NEEDS_ATTENTION',
  );

  const runPublish = () => {
    setPublishConfirmOpen(false);
    startPublish(async () => {
      // Sequential on purpose (see this component's doc comment), expressed as
      // a promise chain rather than a loop because the guide forbids `for..of`.
      // Each step awaits the previous one, so exactly one publish is in flight.
      const results = await publishable.reduce<Promise<PublishOutcome[]>>(
        async (previous, product) => {
          const done = await previous;
          const result: PublishActionResult = await publishProductAction({
            productId: product.sals3ProductId,
            expectedProductVersion: product.productVersion,
          });

          return [
            ...done,
            result.ok
              ? {
                  productId: product.id,
                  name: product.name,
                  slug: result.slug,
                  offerCount: result.offerCount,
                }
              : {
                  productId: product.id,
                  name: product.name,
                  failure: describePublishFailure(result.reason, result.detail),
                },
          ];
        },
        Promise.resolve([]),
      );

      setOutcomes(results);

      if (results.some((outcome) => outcome.failure === undefined)) {
        onPublished();
      }
    });
  };

  function announceUnbuilt(action: string) {
    toast(`${action} isn't built yet.`, {
      description: 'This design preview has no bulk-action backend.',
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2.5">
        <span className="text-sm text-muted-foreground">
          {selectedCount} {selectedCount === 1 ? 'listing' : 'listings'}{' '}
          selected
        </span>
        {canPublish ? (
          <Button
            type="button"
            size="sm"
            disabled={disabled || isPublishing || publishable.length === 0}
            onClick={() => setPublishConfirmOpen(true)}
          >
            <Upload aria-hidden="true" className="size-4" />
            {isPublishing ? 'Publishing…' : 'Publish'}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onBulkPause();
            toast('Selected live listings paused.', {
              description: 'Preview-only: nothing is persisted or synced.',
            });
          }}
        >
          Pause listings
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => setArchiveConfirmOpen(true)}
        >
          Archive
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="outline" size="sm">
                Export
                <ChevronDown aria-hidden="true" className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => announceUnbuilt('Export as CSV')}>
              Export as CSV
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => announceUnbuilt('Export as Excel')}
            >
              Export as Excel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog
          open={archiveConfirmOpen}
          onOpenChange={setArchiveConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Archive {selectedCount}{' '}
                {selectedCount === 1 ? 'listing' : 'listings'}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Archiving stops new sales. It never deletes the product,
                revision, supplier evidence, or audit history, and it never
                affects an already-accepted order.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="px-4 text-xs text-muted-foreground">
              Design preview: nothing is archived on a server. This only updates
              the in-memory list in this tab.
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  setArchiveConfirmOpen(false);
                  onBulkArchive();
                }}
              >
                Archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={publishConfirmOpen}
          onOpenChange={setPublishConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Publish {publishable.length}{' '}
                {publishable.length === 1 ? 'listing' : 'listings'}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Each one is checked on its own. A listing that is not ready is
                left as a draft with its reason, and nothing already live is
                touched.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {publishable.length === selectedCount ? null : (
              <p className="px-4 text-xs text-muted-foreground">
                {selectedCount - publishable.length} of the {selectedCount}{' '}
                selected are illustrative rows with no stored version, so they
                are not included.
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={runPublish}>
                Publish {publishable.length}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <CataloguePublishResults
        outcomes={outcomes}
        onDismiss={() => setOutcomes([])}
      />
    </div>
  );
}
