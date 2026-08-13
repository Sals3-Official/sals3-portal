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
import adaptFixtureRows from '@/lib/seller-center/product-catalogue/adapt-fixture';
import announceUnbuilt from '@/lib/seller-center/product-catalogue/announce-unbuilt';
import {
  countByStatus,
  countNeedsAttention,
  countOutOfStock,
  filterAndSortProducts,
  uniqueCategories,
  uniqueSupplierProviders,
} from '@/lib/seller-center/product-catalogue/filter';
import type {
  CatalogueRowAction,
  VariantActionView,
} from '@/lib/seller-center/product-catalogue/view';
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
  availability: null,
  mediaStatus: null,
  supplierConnectionHealth: null,
  evidenceFreshness: null,
  needsAttentionOnly: false,
  outOfStockOnly: false,
  sort: 'CREATED_DESC',
};

const MANUAL_PAUSE_REASON = 'Manually paused by seller';

/** Row controls this preview cannot honestly perform, and what to call them. */
const UNBUILT_ROW_ACTIONS: Partial<Record<CatalogueRowAction, string>> = {
  editPrice: 'Editing price',
  resume: 'Review & resume',
  publish: 'Publish',
  restore: 'Restore as new draft',
  duplicate: 'Duplicate as new draft',
  viewLive: 'View Live Page',
};

const UNBUILT_VARIANT_ACTIONS: Partial<
  Record<VariantActionView['kind'], string>
> = {
  RESUME: 'Review & resume',
  RECHECK: 'Request fresh check',
};

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
  const [activeTab, setActiveTab] = useState<ListingStatus | 'ALL'>('ALL');
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
  // The fixtures stay the source of truth for filtering; the adapter runs last,
  // at the render boundary, so this preview and the real page share one table.
  const rows = useMemo(
    () => adaptFixtureRows(visibleProducts),
    [visibleProducts],
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

  const handleRowAction = useCallback(
    (id: string, action: CatalogueRowAction) => {
      if (action === 'pause') {
        handlePauseListing(id);

        return;
      }

      if (action === 'archive') {
        setArchiveTargetId(id);

        return;
      }

      const name =
        products.find((product) => product.id === id)?.name ?? 'this listing';

      announceUnbuilt(
        `${UNBUILT_ROW_ACTIONS[action]} isn't built yet for "${name}".`,
      );
    },
    [handlePauseListing, products],
  );

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

  const handleVariantAction = useCallback(
    (productId: string, variantId: string, kind: VariantActionView['kind']) => {
      if (kind === 'PAUSE') {
        toggleVariantPaused(productId, variantId);

        return;
      }

      announceUnbuilt(`${UNBUILT_VARIANT_ACTIONS[kind]} isn't built yet.`);
    },
    [toggleVariantPaused],
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
        rows={rows}
        selectedIds={selectedIds}
        expandedIds={expandedIds}
        onToggleSelected={(id) => toggleSet(selectedIds, setSelectedIds, id)}
        onToggleExpanded={(id) => toggleSet(expandedIds, setExpandedIds, id)}
        onAction={handleRowAction}
        onVariantAction={handleVariantAction}
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
