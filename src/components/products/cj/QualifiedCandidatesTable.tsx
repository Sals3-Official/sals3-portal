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
import {
  candidateDrawerHref,
  PIPELINE_STALE_AFTER_DAYS,
} from '@/lib/portal/pipeline-params';
import { cn } from '@/lib/utils';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import type { ReasonCode } from '@/modules/catalog/candidates/rules/contracts';
import CandidateRow from './CandidateRow';
import {
  displayName,
  formatUsd,
  imageUrl,
  supplierPriceUsd,
  cjSku,
  feedFreeShipping,
  feedOrigins,
  feedSighting,
  listedCount,
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
  /**
   * CJ's Level 1 label per provider category id, resolved from the discovery
   * snapshot the cycle already paid for. A row whose category is absent from
   * the map renders CJ's leaf label alone rather than a guessed ancestor.
   */
  categoryL1ById?: Record<string, string>;
};

const SHARED_COLUMNS = [
  'Select',
  'Product',
  'CJ category',
  'Supplier cost',
  'Origin & stock',
];
const MAX_ADD_BATCH = 5;

const ITEM_FAILURE_MESSAGES: Record<string, string> = {
  not_found: 'Some selected products are no longer in your pipeline.',
  connection_unhealthy: 'Your CJ connection needs attention first.',
  supplier_unavailable: 'CJ did not answer. Remaining products were not saved.',
  rate_limited: 'CJ is rate-limiting this account right now.',
};

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
  categoryL1: string | null;
  now: Date;
  alreadyInCatalogue: boolean;
  selected: boolean;
  isPending: boolean;
  onToggleSelected: (candidateId: string) => void;
};

function QualifiedCandidateRow({
  candidate,
  currentParams,
  showReasons,
  categoryL1,
  now,
  alreadyInCatalogue,
  selected,
  isPending,
  onToggleSelected,
}: QualifiedCandidateRowProps) {
  const name = displayName(candidate);
  const image = imageUrl(candidate);
  const reasonCodes = candidate.evaluation.reasonCodes as ReasonCode[];
  const sku = cjSku(candidate);
  const origins = feedOrigins(candidate);
  const listed = listedCount(candidate);
  const stockChecked = candidate.stockReviewState !== 'STOCK_NOT_CHECKED';
  const sighting = feedSighting(
    candidate.providerLastSeenAt,
    now,
    PIPELINE_STALE_AFTER_DAYS,
  );
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
          <div className="min-w-0">
            <div className="truncate" title={name}>
              {name}
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] leading-4 font-normal">
              {sku === null ? null : (
                <span className="rounded bg-muted px-1 text-ink-muted">
                  {sku}
                </span>
              )}
              <span className="truncate text-ink-faint">
                {candidate.externalProductId}
              </span>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="text-ink-muted">{categoryL1 ?? '—'}</div>
        {candidate.providerCategoryName === null ? null : (
          <div className="text-[11px] leading-4 text-ink-faint">
            {candidate.providerCategoryName}
          </div>
        )}
      </TableCell>
      <TableCell className="tabular-nums">
        {formatUsd(supplierPriceUsd(candidate))}
        {listed === null ? null : (
          <div className="text-[11px] leading-4 text-ink-faint">
            {listed.toLocaleString()} sellers list it
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          {origins.length === 0 ? (
            <span className="text-ink-faint">—</span>
          ) : (
            origins.map((origin) => (
              <span
                key={origin}
                className="rounded-full bg-accent px-2 py-0.5 text-[11px] leading-4 text-accent-foreground"
              >
                {origin}
              </span>
            ))
          )}
          {feedFreeShipping(candidate) ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] leading-4 text-ink-muted">
              Free ship
            </span>
          ) : null}
        </div>
        <div className="text-[11px] leading-4 text-ink-faint">
          {stockChecked ? 'Stock reviewed' : 'Stock not checked'}
        </div>
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
      <TableCell className="text-xs whitespace-nowrap">
        <span className={sighting.stale ? 'text-amber-700' : 'text-ink-muted'}>
          {sighting.label}
        </span>
      </TableCell>
      <TableCell>
        <CustomizeAndListButton
          candidateId={candidate.candidateId}
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
  categoryL1ById = {},
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
    'Feed seen',
    'Action',
  ];
  /*
    One instant for the whole table, taken once per render. Calling `new Date()`
    inside each row would let a long list straddle midnight and report two
    different ages for two rows the feed saw at the same moment.
  */
  const now = useMemo(() => new Date(), []);
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
    if (selectedIds.size > MAX_ADD_BATCH) {
      toast('Select 5 products or fewer.', {
        description:
          'Each product fetches CJ details, inventory, and reviews before saving.',
      });

      return;
    }

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
            : (ITEM_FAILURE_MESSAGES[result.failed[0]?.reason ?? ''] ??
              `${processed} processed, ${result.failed.length} failed.`),
      });
      router.refresh();
    });
  }, [router, selectedIds]);

  return (
    <div className="flex flex-col gap-3">
      {/*
        The bulk action sits WITH the selection it acts on rather than floating
        above the table on its own: a button whose enablement depends on
        checkboxes it is nowhere near reads as broken until you happen to tick
        one. It also states the count, because "Add" over an invisible
        selection is a question, and names the cap before the click rather than
        after it.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <span className="text-sm text-ink-muted">
          {selectedIds.size === 0 ? (
            'Select products to add several at once'
          ) : (
            <>
              <span className="font-semibold text-foreground tabular-nums">
                {selectedIds.size}
              </span>{' '}
              selected
              {selectedIds.size > MAX_ADD_BATCH
                ? ` — ${MAX_ADD_BATCH} is the most that can be added in one go`
                : ''}
            </>
          )}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={selectedIds.size === 0 || isPending}
          onClick={addSelectedToCatalogue}
        >
          <Plus aria-hidden="true" />
          {isPending
            ? 'Adding...'
            : `Add & Customize${selectedIds.size === 0 ? '' : ` (${selectedIds.size})`}`}
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
                categoryL1={
                  candidate.providerCategoryId === null
                    ? null
                    : (categoryL1ById[candidate.providerCategoryId] ?? null)
                }
                now={now}
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
