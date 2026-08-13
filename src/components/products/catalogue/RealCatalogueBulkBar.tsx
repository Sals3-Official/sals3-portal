'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import ArchiveConfirmDialog from './ArchiveConfirmDialog';

type RealCatalogueBulkBarProps = {
  selectedCount: number;
  isArchiving: boolean;
  onArchive: () => void;
};

/**
 * Bulk actions for the REAL catalogue.
 *
 * Archive is the only one that runs, and it is a genuine audited server action.
 * Special price, Pause and Export render disabled with the reason on hover
 * rather than being removed: each is a thing a seller reasonably looks for, and
 * "why can I not do this" is a more useful answer than an absence.
 */
export default function RealCatalogueBulkBar({
  selectedCount,
  isArchiving,
  onArchive,
}: RealCatalogueBulkBarProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const nothingSelected = selectedCount === 0;
  const unbuilt: Array<{ label: string; reason: string }> = [
    {
      label: 'Edit Special Price',
      reason:
        'Pricing is server-owned and unresolved for every product, so there is no price to override yet.',
    },
    {
      label: 'Pause listings',
      reason:
        'Pausing needs a published listing. Publishing is not built yet, so nothing here can be paused.',
    },
    {
      label: 'Export',
      reason: 'Catalogue export is not built yet.',
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2.5">
      <span className="text-sm text-muted-foreground">
        {selectedCount} {selectedCount === 1 ? 'product' : 'products'} selected
      </span>
      {unbuilt.map(({ label, reason }) => (
        <Tooltip key={label}>
          <TooltipTrigger
            render={
              <span>
                <Button type="button" variant="outline" size="sm" disabled>
                  {label}
                </Button>
              </span>
            }
          />
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={nothingSelected || isArchiving}
        aria-busy={isArchiving}
        onClick={() => setConfirmOpen(true)}
      >
        Archive
      </Button>

      <ArchiveConfirmDialog
        open={confirmOpen}
        count={selectedCount}
        onOpenChange={setConfirmOpen}
        onConfirm={onArchive}
      />
    </div>
  );
}
