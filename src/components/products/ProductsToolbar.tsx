import Link from 'next/link';
import {
  PRODUCT_BRAND_LABELS,
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  PRODUCT_SORT_KEYS,
  PRODUCT_SORT_LABELS,
} from '@/lib/products/constants';
import { hasActiveFilters } from '@/lib/products/query';
import type { ProductListQuery } from '@/lib/products/types';
import FilterSelect from './FilterSelect';
import ProductSearchInput from './ProductSearchInput';

type ProductsToolbarProps = {
  query: ProductListQuery;
};

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All categories' },
  ...PRODUCT_CATEGORIES.map((value) => ({
    value,
    label: PRODUCT_CATEGORY_LABELS[value],
  })),
];

const BRAND_OPTIONS = [
  { value: 'all', label: 'All brands' },
  ...PRODUCT_BRANDS.map((value) => ({
    value,
    label: PRODUCT_BRAND_LABELS[value],
  })),
];

const SORT_OPTIONS = PRODUCT_SORT_KEYS.map((value) => ({
  value,
  label: PRODUCT_SORT_LABELS[value],
}));

/** Search, filter, and sort row. Each control writes its state to the URL. */
export default function ProductsToolbar({ query }: ProductsToolbarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <ProductSearchInput value={query.q} />
      <FilterSelect
        id="filter-category"
        label="Category"
        param="category"
        value={query.category}
        options={CATEGORY_OPTIONS}
      />
      <FilterSelect
        id="filter-brand"
        label="Brand"
        param="brand"
        value={query.brand}
        options={BRAND_OPTIONS}
      />
      <FilterSelect
        id="filter-sort"
        label="Sort by"
        param="sort"
        value={query.sort}
        options={SORT_OPTIONS}
        clearValue="updated-desc"
      />
      {hasActiveFilters(query) ? (
        <Link
          href="/products"
          className="flex min-h-9 items-center px-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}
