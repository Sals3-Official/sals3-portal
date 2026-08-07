import type { AllSupplierProductsQuery } from '@/lib/products/catalog-filters';
import type { SupplierConnectionFixture } from '@/lib/products/catalog-types';
import ActiveFilterChips from './ActiveFilterChips';
import CatalogFilterDrawer from './CatalogFilterDrawer';
import EvaluationStatusFilter from './EvaluationStatusFilter';
import SupplierCatalogSortSelect from './SupplierCatalogSortSelect';
import SupplierConnectionFilter from './SupplierConnectionFilter';
import SupplierSearchInput from './SupplierSearchInput';

type SupplierCatalogToolbarProps = {
  basePath: string;
  query: AllSupplierProductsQuery;
  usableConnections: SupplierConnectionFixture[];
  categories: string[];
  shipsFromOptions: string[];
  priceSortDisabled: boolean;
};

/**
 * Search, Supplier, Evaluation status, More filters, and Sort - the "compact
 * but powerful" primary row from spec section 6. Secondary filters
 * (category, stock, ships-from, market, listing) live behind "More filters"
 * (`CatalogFilterDrawer`) so this row stays scannable at any width; on
 * mobile the whole row wraps rather than needing a separate collapse
 * mechanism.
 */
export default function SupplierCatalogToolbar({
  basePath,
  query,
  usableConnections,
  categories,
  shipsFromOptions,
  priceSortDisabled,
}: SupplierCatalogToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SupplierSearchInput basePath={basePath} value={query.q} />
        <SupplierConnectionFilter
          basePath={basePath}
          connections={usableConnections}
          value={query.supplier}
        />
        <EvaluationStatusFilter basePath={basePath} value={query.status} />
        <CatalogFilterDrawer
          basePath={basePath}
          query={query}
          categories={categories}
          shipsFromOptions={shipsFromOptions}
        />
        <div className="ml-auto">
          <SupplierCatalogSortSelect
            basePath={basePath}
            value={query.sort}
            priceSortDisabled={priceSortDisabled}
          />
        </div>
      </div>
      <ActiveFilterChips
        basePath={basePath}
        query={query}
        connections={usableConnections}
      />
    </div>
  );
}
