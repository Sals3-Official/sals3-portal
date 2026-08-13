'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Package, Plus } from 'lucide-react';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { bulkCreateProductDraftsAction } from '@/app/(portal)/listings/product-draft-actions';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { candidateDrawerHref } from '@/lib/portal/pipeline-params';
import { cn } from '@/lib/utils';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import type { ReasonCode } from '@/modules/catalog/candidates/rules/contracts';
import CandidateRow from './CandidateRow';
import {
  displayName,
  formatUsd,
  imageUrl,
  supplierPriceUsd,
} from './candidate-view';
import CustomizeAndListButton from './CustomizeAndListButton';

type QualifiedCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
  /**
   * The page's current `?tab=`/`?q=`/`?page=`, so a row click adds
   * `?candidate=` without losing the view behind the drawer.
   */
  currentParams: Record<string, string>;
  /** Whether to show the "Attention reasons" column (Needs Attention only). */
  showReasons: boolean;
  cataloguedCandidateIds?: string[];
};

const SHARED_COLUMNS = ['Select', 'Product', 'CJ product ID', 'Supplier price'];

function idempotencyKey(candidateId: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2, 12);

  return `catalog-draft:${candidateId}:${random}`;
}

type QualifiedCandidateRowProps = {
  candidate: EvaluatedCandidateRow;
  currentParams: Record<string, string>;
  showReasons: boolean;
  alreadyInCatalogue: boolean;
  selected: boolean;
  isPending: boolean;
  onToggleSelected: (candidateId: string) => void;
};

function QualifiedCandidateRow({
  candidate,
  currentParams,
  showReasons,
  alreadyInCatalogue,
  selected,
  isPending,
  onToggleSelected,
}: QualifiedCandidateRowProps) {
  const name = displayName(candidate);
  const image = imageUrl(candidate);
  const reasonCodes = candidate.evaluation.reasonCodes as ReasonCode[];
  const handleToggleSelected = useCallback(() => {
    onToggleSelected(candidate.candidateId);
  }, [candidate.candidateId, onToggleSelected]);

  return (
    <CandidateRow
      href={candidateDrawerHref(currentParams, candidate.candidateId)}
      label={`Open candidate detail for ${name}`}
      className={cn(
        alreadyInCatalogue &&
          'bg-sky-50/80 hover:bg-sky-50 dark:bg-sky-950/20 dark:hover:bg-sky-950/30',
      )}
    >
      <TableCell>
        <Checkbox
          checked={selected}
          disabled={alreadyInCatalogue || isPending}
          aria-label={`Select ${name}`}
          onCheckedChange={handleToggleSelected}
        />
      </TableCell>
      <TableCell className="max-w-64 font-medium">
        <div className="flex items-center gap-3">
          {image === null ? (
            <div
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted"
            >
              <Package className="size-4 text-ink-faint" />
            </div>
          ) : (
            <Image
              src={image}
              alt={name}
              width={40}
              height={40}
              loading="lazy"
              className="size-10 shrink-0 rounded-md border border-border object-cover"
            />
          )}
          <span className="min-w-0 truncate" title={name}>
            {name}
          </span>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">
        {candidate.externalProductId}
      </TableCell>
      <TableCell className="tabular-nums">
        {formatUsd(supplierPriceUsd(candidate))}
      </TableCell>
      {showReasons ? (
        <TableCell>
          {reasonCodes.length === 0 ? (
            '—'
          ) : (
            <ul className="flex flex-col gap-1">
              {reasonCodes.map((code) => (
                <li key={code}>
                  <StatusPill label={code} tone="warning" />
                </li>
              ))}
            </ul>
          )}
        </TableCell>
      ) : (
        <TableCell>
          <StatusPill
            label={alreadyInCatalogue ? 'In Catalogue' : 'Ready'}
            tone={alreadyInCatalogue ? 'info' : 'success'}
          />
        </TableCell>
      )}
      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
        {candidate.evaluation.evaluatedAt
          ? new Date(candidate.evaluation.evaluatedAt).toLocaleString()
          : '—'}
      </TableCell>
      <TableCell>
        <CustomizeAndListButton
          productName={name}
          disabled={alreadyInCatalogue}
        />
      </TableCell>
    </CandidateRow>
  );
}

/**
 * Ready and Needs Attention share this table. The selection state is client
 * only; the mutation still resolves tenant and candidate ownership on the
 * server action.
 */
export default function QualifiedCandidatesTable({
  candidates,
  currentParams,
  showReasons,
  cataloguedCandidateIds = [],
}: QualifiedCandidatesTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const cataloguedIds = useMemo(
    () => new Set(cataloguedCandidateIds),
    [cataloguedCandidateIds],
  );
  const columns = [
    ...SHARED_COLUMNS,
    showReasons ? 'Attention reasons' : 'Status',
    'Last checked',
    'Action',
  ];
  const selectableIds = useMemo(
    () =>
      candidates
        .filter((candidate) => !cataloguedIds.has(candidate.candidateId))
        .map((candidate) => candidate.candidateId),
    [candidates, cataloguedIds],
  );
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((candidateId) => selectedIds.has(candidateId));

  const toggleSelected = useCallback((candidateId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);

      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((current) => {
      if (allSelected) return new Set();

      const next = new Set(current);

      selectableIds.forEach((candidateId) => next.add(candidateId));

      return next;
    });
  }, [allSelected, selectableIds]);

  const addSelectedToCatalogue = useCallback(() => {
    const requests = [...selectedIds].map((candidateId) => ({
      candidateId,
      idempotencyKey: idempotencyKey(candidateId),
    }));

    startTransition(async () => {
      const result = await bulkCreateProductDraftsAction({ requests });

      if (!result.ok) {
        toast('Could not add products to Product Catalogue.', {
          description: result.reason,
        });

        return;
      }

      const processed = result.created + result.replayed;

      setSelectedIds(new Set());
      toast('Products added to Product Catalogue.', {
        description:
          result.failed.length === 0
            ? `${processed} selected product${processed === 1 ? '' : 's'} processed.`
            : `${processed} processed, ${result.failed.length} failed.`,
      });
      router.refresh();
    });
  }, [router, selectedIds]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={selectedIds.size === 0 || isPending}
          onClick={addSelectedToCatalogue}
        >
          <Plus aria-hidden="true" />
          {isPending ? 'Adding...' : 'Add to Product Catalogue'}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((label) =>
                label === 'Select' ? (
                  <TableHead key={label} className="w-10">
                    <Checkbox
                      checked={allSelected}
                      disabled={selectableIds.length === 0}
                      aria-label="Select all products on this page"
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                ) : (
                  <TableHead key={label}>{label}</TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => (
              <QualifiedCandidateRow
                key={candidate.candidateId}
                candidate={candidate}
                currentParams={currentParams}
                showReasons={showReasons}
                alreadyInCatalogue={cataloguedIds.has(candidate.candidateId)}
                selected={selectedIds.has(candidate.candidateId)}
                isPending={isPending}
                onToggleSelected={toggleSelected}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
