'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import CatalogueProductPagination, {
  type CataloguePageSize,
} from './CatalogueProductPagination';
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
 * Rows per page, and the seller's choice of how many.
 *
 * Client-side, over the array already loaded for filtering — this screen
 * fetches a seller's whole catalogue once and filters/sorts it in the
 * browser, so paging it is a slice, not a second server round trip. The
 * Candidate Pipeline's own pager (`PipelinePagination`) exists for a
 * different scale — tens of thousands of unfiltered candidates — and is
 * server-driven for that reason, not a pattern this screen's data shape
 * needs. 25 is the default a seller has not yet changed; the choice itself
 * lives in `CatalogueProductPagination`'s page-size `Select` (owner request
 * 2026-09-01 — a fixed count gave no way to see more or fewer rows at once).
 */
const DEFAULT_PAGE_SIZE: CataloguePageSize = 25;

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
  /*
    Server truth replaces the local copy when it changes.

    This screen keeps its rows in state so the preview-only bulk actions can
    move them, and `useState` ignores its argument on every render after the
    first. So a real write — pausing a listing from the row menu, or a bulk
    publish — reached the database, revalidated `/listings`, arrived back as new
    props, and was thrown away: the toast said the listing was paused while the
    row it named still read Live until a hard reload.

    React's documented shape for this, rather than an effect: compare during
    render and adjust, which re-renders immediately with no extra commit and no
    flash of the stale list. Local preview edits are discarded on purpose when
    this fires — what the server says outranks what this tab was pretending.
  */
  const [lastServerProducts, setLastServerProducts] = useState(initialProducts);

  if (lastServerProducts !== initialProducts) {
    setLastServerProducts(initialProducts);
    setProducts(initialProducts);
  }

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
  const router = useRouter();
  // Resolved from `products`, not from a second piece of state: the ids are the
  // selection and the rows are the data, so deriving keeps them from drifting
  // when a row is archived or paused out from under a stale selection.
  const selectedProducts = useMemo(
    () => products.filter((product) => selectedIds.has(product.id)),
    [products, selectedIds],
  );
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

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] =
    useState<CataloguePageSize>(DEFAULT_PAGE_SIZE);
  /*
    Same render-time-compare shape as `lastServerProducts` above: switching
    tab, changing a filter, or changing the page size narrows or reshapes
    `visibleProducts`/its paging, and staying on page 6 of a scope that now
    has one page would show nothing and look broken rather than like a
    screen that reset itself sensibly.
  */
  const [lastScope, setLastScope] = useState({ activeTab, filters, pageSize });

  if (
    lastScope.activeTab !== activeTab ||
    lastScope.filters !== filters ||
    lastScope.pageSize !== pageSize
  ) {
    setLastScope({ activeTab, filters, pageSize });
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / pageSize));
  // Clamped rather than reset via another render-time write: archiving the
  // last row on the last page should quietly step back a page, not flash
  // an empty one first.
  const effectivePage = Math.min(page, totalPages);
  const pagedProducts = useMemo(
    () =>
      visibleProducts.slice(
        (effectivePage - 1) * pageSize,
        effectivePage * pageSize,
      ),
    [visibleProducts, effectivePage, pageSize],
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
        selectedProducts={selectedProducts}
        canPublish={
          activeTab !== 'LIVE' && activeTab !== 'LIVE_NEEDS_ATTENTION'
        }
        onBulkPause={handleBulkPause}
        onBulkArchive={handleBulkArchive}
        onPublished={() => {
          // The rows this screen holds came from a server read; a publish that
          // succeeded has moved some of them to LIVE and minted slugs. Refresh
          // rather than patching the local copy, so what is on screen is what
          // was stored and not this component's guess at it.
          setSelectedIds(new Set());
          router.refresh();
        }}
      />
      <CatalogueProductTable
        products={pagedProducts}
        selectedIds={selectedIds}
        expandedIds={expandedIds}
        onToggleSelected={(id) => toggleSet(selectedIds, setSelectedIds, id)}
        onToggleExpanded={(id) => toggleSet(expandedIds, setExpandedIds, id)}
        onToggleSelectAll={() => {
          // `visibleProducts`, not `products`: the box sits above the rows a
          // seller can see, and selecting rows hidden by the tab or a filter
          // would arm the bulk actions against listings they never looked at.
          const allShown = visibleProducts.every((product) =>
            selectedIds.has(product.id),
          );

          setSelectedIds(
            allShown
              ? new Set()
              : new Set(visibleProducts.map((product) => product.id)),
          );
        }}
        onPauseListing={handlePauseListing}
        onArchive={setArchiveTargetId}
        onToggleVariantPaused={toggleVariantPaused}
      />

      {visibleProducts.length === 0 ? null : (
        <CatalogueProductPagination
          page={effectivePage}
          totalPages={totalPages}
          total={visibleProducts.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

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
