import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import SupplierCatalogEmptyState from '@/components/products/catalog/SupplierCatalogEmptyState';
import SupplierCatalogHeader from '@/components/products/catalog/SupplierCatalogHeader';
import SupplierCatalogPagination from '@/components/products/catalog/SupplierCatalogPagination';
import SupplierCatalogResults from '@/components/products/catalog/SupplierCatalogResults';
import SupplierCatalogScenarioSwitcher from '@/components/products/catalog/SupplierCatalogScenarioSwitcher';
import SupplierCatalogToolbar from '@/components/products/catalog/SupplierCatalogToolbar';
import SupplierPartialFailureBanner from '@/components/products/catalog/SupplierPartialFailureBanner';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import { resolveCatalogFxRates } from '@/lib/products/catalog-fx';
import {
  CATALOG_WORLDS,
  getWorld,
} from '@/lib/design-preview/all-supplier-products/fixtures';
import {
  allSupplierProductsQuerySchema,
  distinctCurrencies,
  filterProducts,
  paginate,
  sortProducts,
  usableConnections,
} from '@/lib/products/catalog-filters';

export const metadata: Metadata = {
  title: 'All Supplier Products (redesign preview) · Sals3 Portal',
  robots: { index: false, follow: false },
};

const BASE_PATH = '/design-preview/all-supplier-products';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function usableProducts(
  world: ReturnType<typeof getWorld>,
  usable: ReturnType<typeof usableConnections>,
) {
  const ids = new Set(usable.map((connection) => connection.id));

  return world.products.filter((product) => ids.has(product.connectionId));
}

function bannerCopy(
  activeCount: number,
  activeName: string | undefined,
): string {
  if (activeCount === 0) {
    return 'Connect a supplier account to browse and automatically evaluate supplier products.';
  }

  if (activeCount === 1 && activeName !== undefined) {
    return `Showing supplier products from ${activeName} through your connected account. Automated evaluation runs in the background - there is no manual "Check for Sals3" step.`;
  }

  return 'Products shown here come from your active supplier connections. Supplier prices, inventory, shipping evidence, and availability may have different freshness times. Automated evaluation runs in the background.';
}

/**
 * DESIGN PREVIEW ONLY - not the production `/products` route. Renders the
 * provider-neutral "All Supplier Products" redesign against isolated typed
 * fixtures (`src/lib/design-preview/all-supplier-products/`); nothing here
 * reads the real database, a Drizzle schema, a Supplier App adapter, or the
 * evaluation pipeline. See the delivered report for the full spec mapping.
 *
 * `?scenario=` switches between every required design state (spec section
 * 10) without needing a separate route per state.
 */
export default async function AllSupplierProductsPreviewPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const query = allSupplierProductsQuerySchema.parse(params);
  const world = getWorld(query.scenario);
  const nowIso = new Date().toISOString();

  // Resolved once per request, in parallel with nothing else async on this
  // page - mirrors `resolveStorefrontPricingConfig()`'s "resolve once at the
  // route boundary" pattern for the real storefront feed.
  const rates = await resolveCatalogFxRates();

  const usable = usableConnections(world);
  const connectionsById = Object.fromEntries(
    world.connections.map((connection) => [connection.id, connection]),
  );

  const failedSuppliers = world.fetchFailures
    .filter((failure) => connectionsById[failure.connectionId] !== undefined)
    .map((failure) => ({
      ...failure,
      providerDisplayName:
        connectionsById[failure.connectionId].providerDisplayName,
    }));
  const failedConnectionIds = new Set(
    failedSuppliers.map((failure) => failure.connectionId),
  );
  const healthySupplierNames = usable
    .filter((connection) => !failedConnectionIds.has(connection.id))
    .map((connection) => connection.providerDisplayName);

  const allSuppliersFailed =
    usable.length > 0 &&
    usable.every((connection) => failedConnectionIds.has(connection.id));

  if (usable.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SupplierCatalogScenarioSwitcher
          basePath={BASE_PATH}
          worlds={Object.values(CATALOG_WORLDS)}
          value={world.key}
        />
        <PageHeader
          title="All Supplier Products"
          description="Browse products from your connected supplier apps. Automated evaluation runs in the background."
        />
        <SupplierCatalogEmptyState
          title="No active supplier apps"
          description="Connect a supplier account to browse and automatically evaluate supplier products."
          action={{ label: 'Manage Supplier Apps', href: '/supplier-apps' }}
        />
      </div>
    );
  }

  if (allSuppliersFailed) {
    return (
      <div className="flex flex-col gap-4">
        <SupplierCatalogScenarioSwitcher
          basePath={BASE_PATH}
          worlds={Object.values(CATALOG_WORLDS)}
          value={world.key}
        />
        <PageHeader
          title="All Supplier Products"
          description="Browse products from your connected supplier apps. Automated evaluation runs in the background."
        />
        <SupplierCatalogEmptyState
          title="Every connected supplier is temporarily unavailable"
          description="None of your active supplier connections could be refreshed just now. This is usually temporary - try again shortly, or check Supplier Apps if it continues."
          action={{ label: 'Manage Supplier Apps', href: '/supplier-apps' }}
        />
      </div>
    );
  }

  const filtered = filterProducts(world, query);
  const sorted = sortProducts(filtered, query.sort);
  const { pageItems, totalPages, page } = paginate(sorted, query.page);

  const scopedProducts = usableProducts(world, usable);
  const categories = [...new Set(scopedProducts.map((p) => p.category))].sort();
  const shipsFromOptions = [
    ...new Set(scopedProducts.flatMap((p) => p.shipsFrom)),
  ].sort();
  const priceSortDisabled = distinctCurrencies(filtered).length > 1;

  const currentParams: Record<string, string> = {
    scenario: query.scenario,
    q: query.q,
    supplier: query.supplier,
    status: query.status,
    category: query.category,
    stock: query.stock,
    shipsFrom: query.shipsFrom,
    market: query.market,
    listing: query.listing,
    sort: query.sort,
  };

  const activeName =
    usable.length === 1 ? usable[0].providerDisplayName : undefined;
  const degradedNames = usable
    .filter((connection) => connection.status === 'DEGRADED')
    .map((connection) => connection.providerDisplayName);

  return (
    <div className="flex flex-col gap-4">
      <SupplierCatalogScenarioSwitcher
        basePath={BASE_PATH}
        worlds={Object.values(CATALOG_WORLDS)}
        value={world.key}
      />

      <SupplierCatalogHeader
        totalCount={filtered.length}
        activeSupplierCount={usable.length}
        lastRefreshIso={nowIso}
        nowIso={nowIso}
      />

      <SourcingInfoBanner>
        {bannerCopy(usable.length, activeName)}
      </SourcingInfoBanner>

      {degradedNames.length === 0 ? null : (
        <p
          role="status"
          className="rounded-md border border-amber-600/30 bg-warning-surface px-3 py-2 text-sm text-amber-600"
        >
          Connection degraded: {degradedNames.join(', ')}. Results from{' '}
          {degradedNames.length === 1 ? 'this supplier' : 'these suppliers'} may
          be stale, incomplete, or temporarily unavailable.
        </p>
      )}

      <SupplierPartialFailureBanner
        failedSuppliers={failedSuppliers}
        healthySupplierNames={healthySupplierNames}
        nowIso={nowIso}
      />

      <SupplierCatalogToolbar
        basePath={BASE_PATH}
        query={query}
        usableConnections={usable}
        categories={categories}
        shipsFromOptions={shipsFromOptions}
        priceSortDisabled={priceSortDisabled}
      />

      {filtered.length === 0 ? (
        <SupplierCatalogEmptyState
          title="No supplier products match these filters"
          description="Try removing a filter or clearing your search - the automated pipeline may simply not have anything matching yet."
        />
      ) : (
        <>
          <SupplierCatalogResults
            products={pageItems}
            allProducts={scopedProducts}
            connectionsById={connectionsById}
            rates={rates}
            nowIso={nowIso}
          />
          <SupplierCatalogPagination
            basePath={BASE_PATH}
            page={page}
            totalPages={totalPages}
            total={filtered.length}
            currentParams={currentParams}
          />
        </>
      )}
    </div>
  );
}
