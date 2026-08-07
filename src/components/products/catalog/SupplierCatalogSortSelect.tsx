'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildHref } from '@/lib/portal/search-params';
import type { AllSupplierProductsQuery } from '@/lib/products/catalog-filters';

type SupplierCatalogSortSelectProps = {
  basePath: string;
  value: AllSupplierProductsQuery['sort'];
  /** Disabled (with an explanation) when mixed currencies make price sort misleading. */
  priceSortDisabled: boolean;
};

const SORT_LABELS: Record<AllSupplierProductsQuery['sort'], string> = {
  'recently-updated': 'Recently updated',
  'recently-added': 'Recently added',
  'price-asc': 'Supplier price: low to high',
  'price-desc': 'Supplier price: high to low',
  'evaluation-status': 'Evaluation status',
  name: 'Product name',
};

export default function SupplierCatalogSortSelect({
  basePath,
  value,
  priceSortDisabled,
}: SupplierCatalogSortSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        router.push(
          buildHref(basePath, searchParams, { sort: String(next), page: null }),
        );
      }}
    >
      <SelectTrigger aria-label="Sort by" className="h-9 bg-card">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(
          Object.keys(SORT_LABELS) as Array<AllSupplierProductsQuery['sort']>
        ).map((key) => {
          const isPriceSort = key === 'price-asc' || key === 'price-desc';

          return (
            <SelectItem
              key={key}
              value={key}
              disabled={isPriceSort && priceSortDisabled}
            >
              {SORT_LABELS[key]}
              {isPriceSort && priceSortDisabled ? ' (mixed currencies)' : ''}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
