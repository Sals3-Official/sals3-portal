'use client';

import { cn } from '@/lib/utils';
import {
  CATALOGUE_STATUS_LABELS,
  CATALOGUE_STATUSES,
  type CatalogueStatus,
} from '@/lib/seller-center/product-catalogue/types';

type CatalogueStatusTabsProps = {
  active: CatalogueStatus | 'ALL';
  counts: Record<CatalogueStatus | 'ALL', number>;
  onChange: (status: CatalogueStatus | 'ALL') => void;
};

const TABS: Array<CatalogueStatus | 'ALL'> = ['ALL', ...CATALOGUE_STATUSES];

/**
 * Real client-side filtering over an already-loaded fixture list, so this
 * is genuine tab state (React state, not a URL) rather than a per-tab
 * server query - there is no per-tab request to make, since nothing here
 * reads a database.
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
        const label = tab === 'ALL' ? 'All' : CATALOGUE_STATUS_LABELS[tab];

        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
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
