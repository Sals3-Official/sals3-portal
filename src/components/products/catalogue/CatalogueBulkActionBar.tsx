'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
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

type CatalogueBulkActionBarProps = {
  selectedCount: number;
  onBulkPause: () => void;
  onBulkArchive: () => void;
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
 */
export default function CatalogueBulkActionBar({
  selectedCount,
  onBulkPause,
  onBulkArchive,
}: CatalogueBulkActionBarProps) {
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const disabled = selectedCount === 0;

  function announceUnbuilt(action: string) {
    toast(`${action} isn't built yet.`, {
      description: 'This design preview has no bulk-action backend.',
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2.5">
      <span className="text-sm text-muted-foreground">
        {selectedCount} {selectedCount === 1 ? 'listing' : 'listings'} selected
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => announceUnbuilt('Edit Special Price')}
      >
        Edit Special Price
      </Button>
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
          <DropdownMenuItem onClick={() => announceUnbuilt('Export as Excel')}>
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
              Archiving stops new sales. It never deletes the product, revision,
              supplier evidence, or audit history, and it never affects an
              already-accepted order.
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
    </div>
  );
}
