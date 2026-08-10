'use client';

import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CATALOGUE_SEARCH_FIELD_LABELS,
  CATALOGUE_SORT_LABELS,
  type CatalogueSearchField,
  type CatalogueSortKey,
} from '@/lib/seller-center/product-catalogue/types';

export type CatalogueFilters = {
  searchField: CatalogueSearchField;
  searchTerm: string;
  category: string | null;
  sort: CatalogueSortKey;
  abTestTag: string | null;
  outOfStockOnly: boolean;
};

type CatalogueFilterBarProps = {
  filters: CatalogueFilters;
  onChange: (patch: Partial<CatalogueFilters>) => void;
  categories: string[];
  abTestTags: string[];
  outOfStockCount: number;
};

const ANY_VALUE = '__any__';

/**
 * Every control here is a real client-side filter over the fixture list
 * already in memory - there is no server request to debounce, so this is a
 * plain controlled form rather than URL state (contrast `CjSearchInput`,
 * which debounces into `?cjSearch=` because it drives a real paginated
 * supplier call).
 */
export default function CatalogueFilterBar({
  filters,
  onChange,
  categories,
  abTestTags,
  outOfStockCount,
}: CatalogueFilterBarProps) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Filter product:
        </span>
        <Button
          type="button"
          variant={filters.outOfStockOnly ? 'default' : 'outline'}
          size="sm"
          className={cn(
            'h-7 rounded-full text-xs',
            !filters.outOfStockOnly && 'bg-card',
          )}
          aria-pressed={filters.outOfStockOnly}
          onClick={() => onChange({ outOfStockOnly: !filters.outOfStockOnly })}
        >
          Out of stock ({outOfStockCount})
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex min-w-0 flex-1 items-stretch">
          <Select
            items={CATALOGUE_SEARCH_FIELD_LABELS}
            value={filters.searchField}
            onValueChange={(value) =>
              onChange({ searchField: value as CatalogueSearchField })
            }
          >
            <SelectTrigger className="w-40 rounded-r-none bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATALOGUE_SEARCH_FIELD_LABELS).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          <div className="relative min-w-0 flex-1">
            <Label htmlFor="catalogue-search" className="sr-only">
              {CATALOGUE_SEARCH_FIELD_LABELS[filters.searchField]}
            </Label>
            <Input
              id="catalogue-search"
              type="search"
              value={filters.searchTerm}
              onChange={(event) => onChange({ searchTerm: event.target.value })}
              placeholder="Please input"
              className="h-9 rounded-l-none border-l-0 bg-card pr-8"
            />
            <Search
              aria-hidden="true"
              className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="catalogue-category" className="sr-only">
            Select category
          </Label>
          <Select
            items={{
              [ANY_VALUE]: 'All categories',
              ...Object.fromEntries(categories.map((c) => [c, c])),
            }}
            value={filters.category ?? ANY_VALUE}
            onValueChange={(value) =>
              onChange({ category: value === ANY_VALUE ? null : value })
            }
          >
            <SelectTrigger id="catalogue-category" className="w-52 bg-card">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>All categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="catalogue-sort" className="sr-only">
            Sort by
          </Label>
          <Select
            items={CATALOGUE_SORT_LABELS}
            value={filters.sort}
            onValueChange={(value) =>
              onChange({ sort: value as CatalogueSortKey })
            }
          >
            <SelectTrigger id="catalogue-sort" className="w-52 bg-card">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATALOGUE_SORT_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="catalogue-ab-test" className="sr-only">
            A/B testing
          </Label>
          <Select
            items={{
              [ANY_VALUE]: 'Any',
              ...Object.fromEntries(abTestTags.map((tag) => [tag, tag])),
            }}
            value={filters.abTestTag ?? ANY_VALUE}
            onValueChange={(value) =>
              onChange({ abTestTag: value === ANY_VALUE ? null : value })
            }
          >
            <SelectTrigger id="catalogue-ab-test" className="w-52 bg-card">
              <SelectValue placeholder="A/B testing" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Any</SelectItem>
              {abTestTags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
