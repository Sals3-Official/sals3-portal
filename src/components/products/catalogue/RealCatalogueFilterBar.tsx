'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  LISTINGS_PATH,
  LISTINGS_SEARCH_FIELD_LABELS,
  LISTINGS_SORT_LABELS,
  type ListingsQuery,
} from '@/lib/portal/listings-params';
import { buildHref } from '@/lib/portal/search-params';
import { NOT_TRACKED_EXPLANATIONS } from '@/lib/seller-center/product-catalogue/view';
import type { CatalogueFacets } from '@/modules/catalog/products/catalogue-queries';
import CatalogueFilterSelect from './CatalogueFilterSelect';
import CatalogueSearchInput from './CatalogueSearchInput';

type RealCatalogueFilterBarProps = {
  query: ListingsQuery;
  current: Record<string, string>;
  facets: CatalogueFacets;
};

const ANY = '__any__';

/**
 * The filter bar for the REAL `/listings`.
 *
 * Two things differ from the design preview's bar, both deliberate:
 *
 * 1. **Every control writes to the URL, not to component state.** This page is
 *    paginated, so a client-side filter over the 25 loaded rows would answer a
 *    question about one page while looking like it answered it for the whole
 *    catalogue.
 * 2. **Availability, Media and Evidence freshness render disabled** with the
 *    same explanation their column pills carry. They stay visible on the
 *    owner's instruction: a seller who looks for the filter should learn the
 *    dimension is not measured, not find the control silently removed.
 */
export default function RealCatalogueFilterBar({
  query,
  current,
  facets,
}: RealCatalogueFilterBarProps) {
  const router = useRouter();
  const go = (patch: Record<string, string | null>) => {
    router.push(buildHref(LISTINGS_PATH, current, patch));
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Quick filters:
        </span>
        {[
          { label: 'Needs attention', reason: 'NO_ATTENTION_SYSTEM' as const },
          { label: 'Out of stock', reason: 'NO_STOCK_EVIDENCE_STORE' as const },
        ].map(({ label, reason }) => (
          <Tooltip key={label}>
            <TooltipTrigger
              render={
                <span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled
                    className={cn('h-7 rounded-full bg-card text-xs')}
                  >
                    {label}
                  </Button>
                </span>
              }
            />
            <TooltipContent>{NOT_TRACKED_EXPLANATIONS[reason]}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2.5">
        <CatalogueSearchInput query={query} current={current} />

        <CatalogueFilterSelect
          id="catalogue-category"
          label="Select category"
          value={query.category === '' ? ANY : query.category}
          widthClass="w-44"
          onValueChange={(value) =>
            go({ category: value === ANY ? null : value })
          }
          options={[
            { value: ANY, label: 'All categories' },
            ...facets.categories.map((category) => ({
              value: category.id,
              label: category.path,
            })),
          ]}
        />

        <CatalogueFilterSelect
          id="catalogue-supplier"
          label="Supplier"
          value={query.supplier === '' ? ANY : query.supplier}
          widthClass="w-44"
          onValueChange={(value) =>
            go({ supplier: value === ANY ? null : value })
          }
          options={[
            { value: ANY, label: 'All suppliers' },
            ...facets.providers.map((provider) => ({
              value: provider.code,
              label: provider.displayName,
            })),
          ]}
        />

        <CatalogueFilterSelect
          id="catalogue-availability"
          label="Availability"
          value={ANY}
          widthClass="w-44"
          onValueChange={() => {}}
          options={[{ value: ANY, label: 'Any availability' }]}
          disabledReason={NOT_TRACKED_EXPLANATIONS.NO_STOCK_EVIDENCE_STORE}
        />

        <CatalogueFilterSelect
          id="catalogue-media"
          label="Media status"
          value={ANY}
          widthClass="w-44"
          onValueChange={() => {}}
          options={[{ value: ANY, label: 'Any media status' }]}
          disabledReason={NOT_TRACKED_EXPLANATIONS.NO_MEDIA_WRITERS}
        />

        <CatalogueFilterSelect
          id="catalogue-sort"
          label="Sort by"
          value={query.sort}
          widthClass="w-48"
          onValueChange={(value) => go({ sort: value })}
          options={Object.entries(LISTINGS_SORT_LABELS).map(
            ([value, label]) => ({ value, label }),
          )}
        />
      </div>

      <p className="text-xs text-ink-subtle">
        Searching {LISTINGS_SEARCH_FIELD_LABELS[query.field].toLowerCase()}.
        Filters run as database queries over the whole catalogue, not just this
        page.
      </p>
    </div>
  );
}
