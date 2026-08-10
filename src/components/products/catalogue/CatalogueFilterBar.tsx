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
  AVAILABILITY_LABELS,
  AVAILABILITY_STATES,
  CATALOGUE_SEARCH_FIELD_LABELS,
  CATALOGUE_SORT_LABELS,
  EVIDENCE_FRESHNESS_LABELS,
  MEDIA_STATUSES,
  MEDIA_STATUS_LABELS,
  SUPPLIER_CONNECTION_HEALTH_LABELS,
  SUPPLIER_CONNECTION_HEALTH_STATES,
  type Availability,
  type CatalogueSearchField,
  type CatalogueSortKey,
  type EvidenceFreshness,
  type MediaStatus,
  type SupplierConnectionHealth,
} from '@/lib/seller-center/product-catalogue/types';

export type CatalogueFilters = {
  searchField: CatalogueSearchField;
  searchTerm: string;
  category: string | null;
  supplierProviderCode: string | null;
  availability: Availability | null;
  mediaStatus: MediaStatus | null;
  /**
   * Independent from `availability` - the connection can be `DEGRADED`
   * while individual products still read `AVAILABLE` from their last
   * trusted evidence. Never derive one filter from the other.
   */
  supplierConnectionHealth: SupplierConnectionHealth | null;
  evidenceFreshness: EvidenceFreshness | null;
  needsAttentionOnly: boolean;
  outOfStockOnly: boolean;
  sort: CatalogueSortKey;
};

type CatalogueFilterBarProps = {
  filters: CatalogueFilters;
  onChange: (patch: Partial<CatalogueFilters>) => void;
  categories: string[];
  supplierProviders: Array<{ code: string; name: string }>;
  outOfStockCount: number;
  needsAttentionCount: number;
};

const ANY_VALUE = '__any__';

const SEARCH_PLACEHOLDER: Record<CatalogueSearchField, string> = {
  NAME: 'Search by product name',
  SALS3_PRODUCT_ID: 'Search by Sals3 Product/Variant ID',
  SELLER_SKU: 'Search by Seller SKU',
  SUPPLIER_REFERENCE: 'Search by CJ product/variant reference',
};

/**
 * Every control here is a real client-side filter over the fixture list
 * already in memory - there is no server request to debounce, so this is a
 * plain controlled form rather than URL state (contrast `CjSearchInput`,
 * which debounces into `?cjSearch=` because it drives a real paginated
 * supplier call). The handoff's approved API design keeps these filters as
 * a flat, serializable shape so a future real paginated catalogue can make
 * them URL-backed/server-driven without a redesign.
 */
export default function CatalogueFilterBar({
  filters,
  onChange,
  categories,
  supplierProviders,
  outOfStockCount,
  needsAttentionCount,
}: CatalogueFilterBarProps) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Quick filters:
        </span>
        <Button
          type="button"
          variant={filters.needsAttentionOnly ? 'default' : 'outline'}
          size="sm"
          className={cn(
            'h-7 rounded-full text-xs',
            !filters.needsAttentionOnly && 'bg-card',
          )}
          aria-pressed={filters.needsAttentionOnly}
          onClick={() =>
            onChange({ needsAttentionOnly: !filters.needsAttentionOnly })
          }
        >
          Needs attention ({needsAttentionCount})
        </Button>
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
            <SelectTrigger className="w-44 rounded-r-none bg-card">
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
              placeholder={SEARCH_PLACEHOLDER[filters.searchField]}
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
            <SelectTrigger id="catalogue-category" className="w-44 bg-card">
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
          <Label htmlFor="catalogue-supplier" className="sr-only">
            Supplier
          </Label>
          <Select
            items={{
              [ANY_VALUE]: 'All suppliers',
              ...Object.fromEntries(
                supplierProviders.map((p) => [p.code, p.name]),
              ),
            }}
            value={filters.supplierProviderCode ?? ANY_VALUE}
            onValueChange={(value) =>
              onChange({
                supplierProviderCode: value === ANY_VALUE ? null : value,
              })
            }
          >
            <SelectTrigger id="catalogue-supplier" className="w-44 bg-card">
              <SelectValue placeholder="Supplier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>All suppliers</SelectItem>
              {supplierProviders.map((provider) => (
                <SelectItem key={provider.code} value={provider.code}>
                  {provider.name}
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
            <SelectTrigger id="catalogue-sort" className="w-48 bg-card">
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
      </div>

      <div className="flex flex-wrap items-end gap-2.5 border-t border-border pt-2.5">
        <span className="pb-2 text-xs font-medium text-muted-foreground">
          Refine by:
        </span>

        <div className="flex flex-col gap-1">
          <Label htmlFor="catalogue-availability" className="sr-only">
            Availability
          </Label>
          <Select
            items={{
              [ANY_VALUE]: 'Any availability',
              ...Object.fromEntries(
                AVAILABILITY_STATES.map((state) => [
                  state,
                  AVAILABILITY_LABELS[state],
                ]),
              ),
            }}
            value={filters.availability ?? ANY_VALUE}
            onValueChange={(value) =>
              onChange({
                availability:
                  value === ANY_VALUE ? null : (value as Availability),
              })
            }
          >
            <SelectTrigger id="catalogue-availability" className="w-48 bg-card">
              <SelectValue placeholder="Availability" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Any availability</SelectItem>
              {AVAILABILITY_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {AVAILABILITY_LABELS[state]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="catalogue-media" className="sr-only">
            Media status
          </Label>
          <Select
            items={{
              [ANY_VALUE]: 'Any media status',
              ...Object.fromEntries(
                MEDIA_STATUSES.map((state) => [
                  state,
                  MEDIA_STATUS_LABELS[state],
                ]),
              ),
            }}
            value={filters.mediaStatus ?? ANY_VALUE}
            onValueChange={(value) =>
              onChange({
                mediaStatus:
                  value === ANY_VALUE ? null : (value as MediaStatus),
              })
            }
          >
            <SelectTrigger id="catalogue-media" className="w-48 bg-card">
              <SelectValue placeholder="Media status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Any media status</SelectItem>
              {MEDIA_STATUSES.map((state) => (
                <SelectItem key={state} value={state}>
                  {MEDIA_STATUS_LABELS[state]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="catalogue-connection-health" className="sr-only">
            Supplier connection health
          </Label>
          <Select
            items={{
              [ANY_VALUE]: 'Any connection health',
              ...Object.fromEntries(
                SUPPLIER_CONNECTION_HEALTH_STATES.map((state) => [
                  state,
                  SUPPLIER_CONNECTION_HEALTH_LABELS[state],
                ]),
              ),
            }}
            value={filters.supplierConnectionHealth ?? ANY_VALUE}
            onValueChange={(value) =>
              onChange({
                supplierConnectionHealth:
                  value === ANY_VALUE
                    ? null
                    : (value as SupplierConnectionHealth),
              })
            }
          >
            <SelectTrigger
              id="catalogue-connection-health"
              className="w-48 bg-card"
            >
              <SelectValue placeholder="Supplier connection health" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Any connection health</SelectItem>
              {SUPPLIER_CONNECTION_HEALTH_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {SUPPLIER_CONNECTION_HEALTH_LABELS[state]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="catalogue-freshness" className="sr-only">
            Supplier evidence freshness
          </Label>
          <Select
            items={{
              [ANY_VALUE]: 'Any freshness',
              ...EVIDENCE_FRESHNESS_LABELS,
            }}
            value={filters.evidenceFreshness ?? ANY_VALUE}
            onValueChange={(value) =>
              onChange({
                evidenceFreshness:
                  value === ANY_VALUE ? null : (value as EvidenceFreshness),
              })
            }
          >
            <SelectTrigger id="catalogue-freshness" className="w-48 bg-card">
              <SelectValue placeholder="Evidence freshness" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Any freshness</SelectItem>
              {Object.entries(EVIDENCE_FRESHNESS_LABELS).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
