import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  LISTINGS_PATH,
  LISTINGS_STATUS_FILTERS,
  type ListingsStatusFilter,
} from '@/lib/portal/listings-params';
import { buildHref } from '@/lib/portal/search-params';
import type { ProductPublicationState } from '@/lib/seller-center/product-catalogue/status';

type CatalogueTabsProps = {
  active: ListingsStatusFilter;
  totals: Record<ProductPublicationState, number>;
  /** Carried so switching status keeps the search. Page resets by design. */
  currentParams: Record<string, string>;
};

const FILTER_LABELS: Record<ListingsStatusFilter, string> = {
  all: 'All',
  draft: 'Draft',
  live: 'Live',
  paused: 'Paused',
  archived: 'Archived',
};

const FILTER_STATE: Record<
  Exclude<ListingsStatusFilter, 'all'>,
  ProductPublicationState
> = {
  draft: 'UNPUBLISHED',
  live: 'PUBLISHED',
  paused: 'PAUSED',
  archived: 'ARCHIVED',
};

function totalFor(
  filter: ListingsStatusFilter,
  totals: Record<ProductPublicationState, number>,
): number {
  if (filter === 'all')
    return Object.values(totals).reduce((sum, value) => sum + value, 0);

  return totals[FILTER_STATE[filter]];
}

/**
 * Status tabs as real links (the filter is server-side SQL), mirroring
 * `PipelineTabs`. Counts are the unfiltered per-state totals, never
 * search-narrowed - the badges report what the catalogue holds.
 */
export default function CatalogueTabs({
  active,
  totals,
  currentParams,
}: CatalogueTabsProps) {
  return (
    <nav
      aria-label="Catalogue status"
      className="flex w-fit flex-wrap items-center gap-1 rounded-lg bg-muted p-1"
    >
      {LISTINGS_STATUS_FILTERS.map((filter) => (
        <Link
          key={filter}
          href={buildHref(LISTINGS_PATH, currentParams, {
            status: filter === 'all' ? null : filter,
            page: null,
          })}
          aria-current={filter === active ? 'page' : undefined}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
            filter === active
              ? 'bg-card font-medium shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {FILTER_LABELS[filter]}
          <span className="text-xs text-ink-subtle tabular-nums">
            {totalFor(filter, totals).toLocaleString()}
          </span>
        </Link>
      ))}
    </nav>
  );
}
