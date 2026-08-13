'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import archiveProductsAction from '@/app/(portal)/listings/archive-action';
import type { CatalogueRowView } from '@/lib/seller-center/product-catalogue/view';
import summarizeArchiveOutcomes, {
  archiveFailureMessage,
} from '@/lib/seller-center/product-catalogue/archive-summary';
import ArchiveConfirmDialog from './ArchiveConfirmDialog';
import CatalogueProductTable from './CatalogueProductTable';
import RealCatalogueBulkBar from './RealCatalogueBulkBar';

type RealCatalogueWorkspaceProps = {
  rows: CatalogueRowView[];
};

function toggle(set: Set<string>, id: string) {
  const next = new Set(set);

  if (next.has(id)) next.delete(id);
  else next.add(id);

  return next;
}

/**
 * Client state for the REAL Product Catalogue: which rows are selected, which
 * are expanded, and the Archive call.
 *
 * Six pieces of state, not sixteen. Everything the server owns - filters,
 * search, sort, page, and the rows themselves - stays in the URL and arrives as
 * props, so this component cannot drift out of step with what the database was
 * actually asked. The only thing it owns is what a click means before it becomes
 * a request.
 */
export default function RealCatalogueWorkspace({
  rows,
}: RealCatalogueWorkspaceProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [archiveTargetIds, setArchiveTargetIds] = useState<string[] | null>(
    null,
  );
  const [isArchiving, startArchiving] = useTransition();

  const runArchive = (productIds: string[]) => {
    startArchiving(async () => {
      const result = await archiveProductsAction({ productIds });

      if (!result.ok) {
        toast('Archive did not run.', {
          description: archiveFailureMessage(result.reason),
        });

        return;
      }

      const summary = summarizeArchiveOutcomes(result.outcomes);

      toast(summary.title, { description: summary.description });
      // Keep only what did not archive selected, so a retry is one click.
      setSelectedIds(new Set(summary.retryableIds));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <RealCatalogueBulkBar
        selectedCount={selectedIds.size}
        isArchiving={isArchiving}
        onArchive={() => runArchive([...selectedIds])}
      />
      <CatalogueProductTable
        rows={rows}
        selectedIds={selectedIds}
        expandedIds={expandedIds}
        onToggleSelected={(id) => setSelectedIds((set) => toggle(set, id))}
        onToggleExpanded={(id) => setExpandedIds((set) => toggle(set, id))}
        onAction={(id, action) => {
          // Only Archive is ever enabled on a real row; every other control
          // arrives hidden or disabled from `adapt-real`.
          if (action === 'archive') setArchiveTargetIds([id]);
        }}
        onVariantAction={() => {}}
      />
      <ArchiveConfirmDialog
        open={archiveTargetIds !== null}
        count={archiveTargetIds?.length ?? 0}
        onOpenChange={(open) => {
          if (!open) setArchiveTargetIds(null);
        }}
        onConfirm={() => {
          if (archiveTargetIds !== null) runArchive(archiveTargetIds);
          setArchiveTargetIds(null);
        }}
      />
    </div>
  );
}
