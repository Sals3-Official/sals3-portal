'use client';

import { useCallback, useMemo, useState } from 'react';
import type {
  CatalogueProductFixture,
  CatalogueStatus,
} from '@/lib/seller-center/product-catalogue/types';
import {
  countByStatus,
  countOutOfStock,
  filterAndSortProducts,
  uniqueAbTestTags,
  uniqueCategories,
} from '@/lib/seller-center/product-catalogue/filter';
import CatalogueBulkActionBar from './CatalogueBulkActionBar';
import CatalogueFilterBar, {
  type CatalogueFilters,
} from './CatalogueFilterBar';
import CatalogueProductTable from './CatalogueProductTable';
import CatalogueStatusTabs from './CatalogueStatusTabs';

type ProductCatalogueWorkspaceProps = {
  initialProducts: CatalogueProductFixture[];
};

const DEFAULT_FILTERS: CatalogueFilters = {
  searchField: 'NAME',
  searchTerm: '',
  category: null,
  sort: 'CREATED_DESC',
  abTestTag: null,
  outOfStockOnly: false,
};

/**
 * Holds every piece of state this design preview actually needs to be
 * honestly interactive: tab/filter/sort selection, bulk selection, row
 * expansion, and the active toggles. All of it lives in this tab only -
 * a reload resets it, same as the Product Editor's own fixture state.
 */
export default function ProductCatalogueWorkspace({
  initialProducts,
}: ProductCatalogueWorkspaceProps) {
  const [products, setProducts] = useState(initialProducts);
  const [activeTab, setActiveTab] = useState<CatalogueStatus | 'ALL'>('ALL');
  const [filters, setFilters] = useState<CatalogueFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const counts = useMemo(() => countByStatus(products), [products]);
  const categories = useMemo(() => uniqueCategories(products), [products]);
  const abTestTags = useMemo(() => uniqueAbTestTags(products), [products]);
  const outOfStockCount = useMemo(() => countOutOfStock(products), [products]);
  const visibleProducts = useMemo(
    () => filterAndSortProducts(products, activeTab, filters),
    [products, activeTab, filters],
  );

  function toggleSet(
    set: Set<string>,
    setSet: (next: Set<string>) => void,
    id: string,
  ) {
    const next = new Set(set);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    setSet(next);
  }

  const toggleProductActive = useCallback((id: string) => {
    setProducts((current) =>
      current.map((product) =>
        product.id === id ? { ...product, active: !product.active } : product,
      ),
    );
  }, []);

  const toggleVariantActive = useCallback(
    (productId: string, variantId: string) => {
      setProducts((current) =>
        current.map((product) => {
          if (product.id !== productId) return product;

          return {
            ...product,
            variants: product.variants.map((variant) =>
              variant.id === variantId
                ? { ...variant, active: !variant.active }
                : variant,
            ),
          };
        }),
      );
    },
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <CatalogueStatusTabs
        active={activeTab}
        counts={counts}
        onChange={setActiveTab}
      />
      <CatalogueFilterBar
        filters={filters}
        onChange={(patch) =>
          setFilters((current) => ({ ...current, ...patch }))
        }
        categories={categories}
        abTestTags={abTestTags}
        outOfStockCount={outOfStockCount}
      />
      <CatalogueBulkActionBar selectedCount={selectedIds.size} />
      <CatalogueProductTable
        products={visibleProducts}
        selectedIds={selectedIds}
        expandedIds={expandedIds}
        onToggleSelected={(id) => toggleSet(selectedIds, setSelectedIds, id)}
        onToggleExpanded={(id) => toggleSet(expandedIds, setExpandedIds, id)}
        onToggleActive={toggleProductActive}
        onToggleVariantActive={toggleVariantActive}
      />
    </div>
  );
}
