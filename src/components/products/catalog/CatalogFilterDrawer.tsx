'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { buildHref } from '@/lib/portal/search-params';
import { getAllMarkets } from '@/lib/seller-center/market-config';
import { STOCK_TEXT } from '@/lib/products/catalog-presentation';
import type { AllSupplierProductsQuery } from '@/lib/products/catalog-filters';
import type {
  ListingState,
  StockAvailability,
} from '@/lib/products/catalog-types';

type CatalogFilterDrawerProps = {
  basePath: string;
  query: AllSupplierProductsQuery;
  categories: string[];
  shipsFromOptions: string[];
};

const STOCK_OPTIONS: StockAvailability[] = [
  'IN_STOCK',
  'PARTIAL_VARIANT_STOCK',
  'OUT_OF_STOCK',
  'UNKNOWN',
];

const LISTING_OPTIONS: Array<{ value: ListingState; label: string }> = [
  { value: 'NOT_LISTED', label: 'Not listed' },
  { value: 'HAS_LISTING', label: 'Has existing Sals3 listing' },
  { value: 'MULTIPLE_LISTINGS', label: 'Multiple listings' },
];

function csv(value: string): string[] {
  return value === '' ? [] : value.split(',').filter((part) => part !== '');
}

function toggled(
  current: string,
  value: string,
  checked: boolean,
): string | null {
  const set = new Set(csv(current));

  if (checked) {
    set.add(value);
  } else {
    set.delete(value);
  }

  return set.size === 0 ? null : [...set].join(',');
}

/**
 * Secondary filters that would crowd the toolbar (spec section 6, controls
 * 4-9): category, stock, ships-from, destination market, and listing state.
 * Every option list is dynamic - categories and ships-from come from what is
 * actually in the current result set, and destination markets come from the
 * seller's own enabled sample markets
 * (`src/lib/seller-center/market-config.ts`), never a hardcoded country
 * list.
 */
export default function CatalogFilterDrawer({
  basePath,
  query,
  categories,
  shipsFromOptions,
}: CatalogFilterDrawerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const markets = getAllMarkets();
  const selectedStock = new Set(csv(query.stock));
  const selectedShipsFrom = new Set(csv(query.shipsFrom));
  const selectedListing = new Set(csv(query.listing));

  function patch(
    next: Partial<Record<keyof AllSupplierProductsQuery, string | null>>,
  ) {
    router.push(buildHref(basePath, searchParams, { ...next, page: null }));
  }

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button type="button" variant="outline" className="h-9 bg-card">
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            More filters
          </Button>
        }
      />
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>More filters</SheetTitle>
          <SheetDescription>
            Category, stock, shipping origin, destination market, and listing
            state.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-category">Category</Label>
            <Select
              value={query.category}
              onValueChange={(next) =>
                patch({ category: next === 'all' ? null : String(next) })
              }
            >
              <SelectTrigger id="filter-category" className="w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              Stock availability
            </legend>
            {STOCK_OPTIONS.map((stock) => (
              <div key={stock} className="flex items-center gap-2">
                <Checkbox
                  id={`stock-${stock}`}
                  checked={selectedStock.has(stock)}
                  onCheckedChange={(checked) =>
                    patch({
                      stock: toggled(query.stock, stock, checked === true),
                    })
                  }
                />
                <Label htmlFor={`stock-${stock}`}>
                  {STOCK_TEXT[stock].label}
                </Label>
              </div>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Ships from</legend>
            {shipsFromOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No shipping-origin data in the current results.
              </p>
            ) : (
              shipsFromOptions.map((origin) => (
                <div key={origin} className="flex items-center gap-2">
                  <Checkbox
                    id={`ships-${origin}`}
                    checked={selectedShipsFrom.has(origin)}
                    onCheckedChange={(checked) =>
                      patch({
                        shipsFrom: toggled(
                          query.shipsFrom,
                          origin,
                          checked === true,
                        ),
                      })
                    }
                  />
                  <Label htmlFor={`ships-${origin}`}>{origin}</Label>
                </div>
              ))
            )}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-market">Destination market</Label>
            <Select
              value={query.market}
              onValueChange={(next) =>
                patch({ market: next === 'all' ? null : String(next) })
              }
            >
              <SelectTrigger id="filter-market" className="w-full bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every enabled market</SelectItem>
                {markets.map((market) => (
                  <SelectItem key={market.code} value={market.code}>
                    {market.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only your own seller-enabled and policy-approved markets are
              listed here.
            </p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Listing state</legend>
            {LISTING_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={`listing-${option.value}`}
                  checked={selectedListing.has(option.value)}
                  onCheckedChange={(checked) =>
                    patch({
                      listing: toggled(
                        query.listing,
                        option.value,
                        checked === true,
                      ),
                    })
                  }
                />
                <Label htmlFor={`listing-${option.value}`}>
                  {option.label}
                </Label>
              </div>
            ))}
          </fieldset>
        </div>
      </SheetContent>
    </Sheet>
  );
}
