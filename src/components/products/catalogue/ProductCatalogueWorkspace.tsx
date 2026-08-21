'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type {
  CatalogueProductFixture,
  ListingStatus,
} from '@/lib/seller-center/product-catalogue/types';
import {
  countByStatus,
  countNeedsAttention,
  countOutOfStock,
  filterAndSortProducts,
  uniqueCategories,
  uniqueSupplierProviders,
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
  supplierProviderCode: null,
  mediaStatus: null,
  supplierConnectionHealth: null,
  evidenceFreshness: null,
  needsAttentionOnly: false,
  outOfStockOnly: false,
  sort: 'CREATED_DESC',
};

const MANUAL_PAUSE_REASON = 'Manually paused by seller';

/**
 * Holds every piece of state this design preview actually needs to be
 * honestly interactive: tab/filter/sort selection, bulk selection, row
 * expansion, and pause/archive. All of it lives in this tab only - a
 * reload resets it, same as the Product Editor's own fixture state.
 *
 * Pause is a real (in-memory) state transition - a seller can always pause
 * a live listing/variant, so faking that is unnecessary. Resume/Publish
 * stay disabled/unbuilt everywhere in this tree because they would need
 * server-side gates that do not exist yet, so this workspace never
 * simulates either succeeding.
 */
export default function ProductCatalogueWorkspace({
  initialProducts,
}: ProductCatalogueWorkspaceProps) {
  const [products, setProducts] = useState(initialProducts);
  /**
   * Opens on **Live**, not `All` — owner decision 2026-08-22. The screen's
   * everyday job is the listings a buyer can currently see; drafts are one
   * click away and `All` is still the leftmost tab. Consequence to accept: a
   * seller whose catalogue is entirely drafts lands on the empty state and has
   * to pick a tab. That is deliberate rather than a silent fallback to `All`,
   * which would make the landing tab depend on data and read as a bug the
   * first time a published listing changed it.
   */
  const [activeTab, setActiveTab] = useState<ListingStatus | 'ALL'>('LIVE');
  const [filters, setFilters] = useState<CatalogueFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);

  const counts = useMemo(() => countByStatus(products), [products]);
  const categories = useMemo(() => uniqueCategories(products), [products]);
  const supplierProviders = useMemo(
    () => uniqueSupplierProviders(products),
    [products],
  );
  const outOfStockCount = useMemo(() => countOutOfStock(products), [products]);
  const needsAttentionCount = useMemo(
    () => countNeedsAttention(products),
    [products],
  );
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

  const pauseListing = useCallback((id: string) => {
    setProducts((current) =>
      current.map((product) =>
        product.id === id
          ? {
              ...product,
              status: 'AUTO_PAUSED',
              pauseReason: MANUAL_PAUSE_REASON,
            }
          : product,
      ),
    );
  }, []);

  const handlePauseListing = useCallback(
    (id: string) => {
      pauseListing(id);
      toast('Listing paused.', {
        description: 'Preview-only: nothing is persisted or synced.',
      });
    },
    [pauseListing],
  );

  const archiveListing = useCallback((id: string) => {
    setProducts((current) =>
      current.map((product) =>
        product.id === id ? { ...product, status: 'ARCHIVED' } : product,
      ),
    );
  }, []);

  const handleBulkPause = useCallback(() => {
    setProducts((current) =>
      current.map((product) =>
        selectedIds.has(product.id) &&
        (product.status === 'LIVE' || product.status === 'LIVE_NEEDS_ATTENTION')
          ? {
              ...product,
              status: 'AUTO_PAUSED',
              pauseReason: MANUAL_PAUSE_REASON,
            }
          : product,
      ),
    );
  }, [selectedIds]);

  const handleBulkArchive = useCallback(() => {
    setProducts((current) =>
      current.map((product) =>
        selectedIds.has(product.id)
          ? { ...product, status: 'ARCHIVED' }
          : product,
      ),
    );
    setSelectedIds(new Set());
    toast('Selected listings archived.', {
      description: 'Preview-only: nothing is persisted or synced.',
    });
  }, [selectedIds]);

  const toggleVariantPaused = useCallback(
    (productId: string, variantId: string) => {
      let nowPaused = false;

      setProducts((current) =>
        current.map((product) => {
          if (product.id !== productId) return product;

          return {
            ...product,
            variants: product.variants.map((variant) => {
              if (variant.id !== variantId) return variant;

              nowPaused = !variant.manuallyPaused;

              return { ...variant, manuallyPaused: nowPaused };
            }),
          };
        }),
      );
      toast(nowPaused ? 'Variant paused.' : 'Variant pause lifted.', {
        description: 'Preview-only: nothing is persisted or synced.',
      });
    },
    [],
  );

  const archiveTarget =
    products.find((product) => product.id === archiveTargetId) ?? null;

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
        supplierProviders={supplierProviders}
        outOfStockCount={outOfStockCount}
        needsAttentionCount={needsAttentionCount}
      />
      <CatalogueBulkActionBar
        selectedCount={selectedIds.size}
        onBulkPause={handleBulkPause}
        onBulkArchive={handleBulkArchive}
      />
      <CatalogueProductTable
        products={visibleProducts}
        selectedIds={selectedIds}
        expandedIds={expandedIds}
        onToggleSelected={(id) => toggleSet(selectedIds, setSelectedIds, id)}
        onToggleExpanded={(id) => toggleSet(expandedIds, setExpandedIds, id)}
        onPauseListing={handlePauseListing}
        onArchive={setArchiveTargetId}
        onToggleVariantPaused={toggleVariantPaused}
      />

      <AlertDialog
        open={archiveTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTargetId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {archiveTarget?.name ?? 'this listing'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Archiving stops new sales. It never deletes the product, revision,
              supplier evidence, or audit history, and it never affects an
              already-accepted order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="px-4 text-xs text-muted-foreground">
            Design preview: nothing is archived on a server. This only updates
            the in-memory list in this tab.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (archiveTargetId !== null) archiveListing(archiveTargetId);
                setArchiveTargetId(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
