'use client';

import { cn } from '@/lib/utils';
import {
  LISTING_STATUS_LABELS,
  LISTING_STATUSES,
  type ListingStatus,
} from '@/lib/seller-center/product-catalogue/types';

type CatalogueStatusTabsProps = {
  active: ListingStatus | 'ALL';
  counts: Record<ListingStatus | 'ALL', number>;
  onChange: (status: ListingStatus | 'ALL') => void;
};

const TABS: Array<ListingStatus | 'ALL'> = ['ALL', ...LISTING_STATUSES];

/**
 * Real client-side filtering over an already-loaded fixture list, so this
 * is genuine tab state (React state, not a URL) rather than a per-tab
 * server query - there is no per-tab request to make, since nothing here
 * reads a database. The tab set is ADR-011's five-state listing lifecycle,
 * not a retail Active/Inactive/Pending QC/Violation/Deleted set - there is
 * deliberately no `Deleted` tab; Archive is the safe lifecycle action.
 */
export default function CatalogueStatusTabs({
  active,
  counts,
  onChange,
}: CatalogueStatusTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Filter by listing status"
      className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border"
    >
      {TABS.map((tab) => {
        const isActive = tab === active;
        const label = tab === 'ALL' ? 'All' : LISTING_STATUS_LABELS[tab];

        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={label}
            onClick={() => onChange(tab)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {counts[tab] > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {counts[tab]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
