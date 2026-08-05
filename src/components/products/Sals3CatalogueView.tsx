import ProductsEmptyState from '@/components/products/ProductsEmptyState';
import ProductsPagination from '@/components/products/ProductsPagination';
import ProductStatusTabs from '@/components/products/ProductStatusTabs';
import ProductsTable, {
  type ProductTablePermissions,
} from '@/components/products/ProductsTable';
import ProductsToolbar from '@/components/products/ProductsToolbar';
import { hasActiveFilters } from '@/lib/products/query';
import type { ProductListQuery, ProductListResult } from '@/lib/products/types';

type Sals3CatalogueViewProps = {
  query: ProductListQuery;
  result: ProductListResult;
  permissions: ProductTablePermissions;
};

/** The Sals3 catalogue view: status tabs, toolbar, table, and pages. */
export default function Sals3CatalogueView({
  query,
  result,
  permissions,
}: Sals3CatalogueViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <ProductStatusTabs query={query} counts={result.statusCounts} />
      <ProductsToolbar query={query} />

      {result.products.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <ProductsEmptyState
            filtered={hasActiveFilters(query)}
            canCreate={permissions.canCreate}
          />
        </div>
      ) : (
        <>
          <ProductsTable
            products={result.products}
            sort={query.sort}
            permissions={permissions}
          />
          <ProductsPagination
            query={query}
            page={result.page}
            totalPages={result.totalPages}
            totalCount={result.totalCount}
          />
        </>
      )}
    </div>
  );
}
