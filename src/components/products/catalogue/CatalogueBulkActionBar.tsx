'use client';

import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type CatalogueBulkActionBarProps = {
  selectedCount: number;
};

/**
 * Selection state is real (`ProductCatalogueWorkspace` tracks it and this
 * bar's disabled state reflects it honestly). The actions themselves are
 * not - there is no bulk-price, deactivate, delete, or export endpoint
 * behind this preview - so each one states that plainly instead of faking
 * success, matching `CustomizeAndListButton`'s convention elsewhere in
 * Product Sourcing.
 */
export default function CatalogueBulkActionBar({
  selectedCount,
}: CatalogueBulkActionBarProps) {
  const disabled = selectedCount === 0;

  function announceUnbuilt(action: string) {
    toast(`${action} isn't built yet.`, {
      description: 'This design preview has no bulk-action backend.',
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2.5">
      <span className="text-sm text-muted-foreground">
        {selectedCount} {selectedCount === 1 ? 'product' : 'products'} selected
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
        onClick={() => announceUnbuilt('Deactivate')}
      >
        Deactivate
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => announceUnbuilt('Delete')}
      >
        Delete
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
    </div>
  );
}
