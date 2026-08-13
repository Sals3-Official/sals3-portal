import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import CatalogueEmptyState from '@/components/products/catalogue/CatalogueEmptyState';
import CatalogueTabs from '@/components/products/catalogue/CatalogueTabs';
import RealCatalogueFilterBar from '@/components/products/catalogue/RealCatalogueFilterBar';
import RealCatalogueWorkspace from '@/components/products/catalogue/RealCatalogueWorkspace';
import PipelinePagination from '@/components/products/cj/PipelinePagination';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import { readOrUnavailable } from '@/lib/db/availability';
import { resolvePageWindow } from '@/lib/portal/pagination';
import {
  LISTINGS_PATH,
  listingsCurrentParams,
  listingsQuerySchema,
} from '@/lib/portal/listings-params';
import adaptRealRows from '@/lib/seller-center/product-catalogue/adapt-real';
import { statesForFilter } from '@/lib/seller-center/product-catalogue/status';
import {
  listCatalogueVariants,
  summarizeCataloguePricing,
} from '@/modules/catalog/products/catalogue-detail-queries';
import {
  CATALOGUE_PAGE_SIZE,
  countCatalogueByPublicationState,
  countCatalogueRowsForSteward,
  listCatalogueFacets,
  listCatalogueRowsForSteward,
} from '@/modules/catalog/products/catalogue-queries';

export const metadata: Metadata = {
  title: 'Product Catalogue · Sals3 Portal',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * The REAL Product Catalogue: the steward seller's `products` rows, straight
 * from the database. This replaced the fictional-fixture preview, which lives
 * on unchanged at `/design-preview/product-catalogue` as the reviewed design
 * artifact. Rows arrive here through Product Sourcing's "Add to Product
 * Catalogue"; everything starts UNPUBLISHED because publication is a separate,
 * unbuilt flow with database-enforced gates.
 */
export default async function ProductCataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = listingsQuerySchema.parse(await searchParams);

  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Product Catalogue"
          description="Your Sals3 products"
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so catalogue products cannot be read."
        />
      </div>
    );
  }

  const resolved = await readOrUnavailable('product catalogue', async () => {
    const { sellerAccount } = await requireDropshipperAccount();
    const filters = {
      states: statesForFilter(query.status),
      search: query.q,
      searchField: query.field,
      categoryId: query.category === '' ? null : query.category,
      providerCode: query.supplier === '' ? null : query.supplier,
    };
    // Wave 1: everything that does not need the page's product ids.
    const [totals, filteredTotal, facets] = await Promise.all([
      countCatalogueByPublicationState(sellerAccount.id),
      countCatalogueRowsForSteward(sellerAccount.id, filters),
      listCatalogueFacets(sellerAccount.id),
    ]);
    const window = resolvePageWindow(
      filteredTotal,
      query.page,
      CATALOGUE_PAGE_SIZE,
    );
    const rows = await listCatalogueRowsForSteward(sellerAccount.id, {
      ...filters,
      sort: query.sort,
      limit: window.pageSize,
      offset: window.offset,
    });
    // Wave 2: the two id-keyed reads, one statement each - never per row.
    const productIds = rows.map((row) => row.productId);
    const [variantsByProduct, pricingByProduct] = await Promise.all([
      listCatalogueVariants(productIds),
      summarizeCataloguePricing(sellerAccount.id, productIds),
    ]);

    return {
      totals,
      window,
      facets,
      views: adaptRealRows(rows, variantsByProduct, pricingByProduct),
    };
  });

  if (!resolved.ok) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Product Catalogue"
          description="Your Sals3 products"
        />
        <SourcingEmptyState
          title="Cannot reach the database right now"
          description="Catalogue products could not be loaded because the database did not respond. Nothing has been changed. Check that Postgres is running, then reload."
        />
      </div>
    );
  }

  const { totals, window, facets, views } = resolved.data;
  const currentParams = listingsCurrentParams(query);
  const noun = window.total === 1 ? 'product' : 'products';
  // Across every status, not just this tab: a seller whose only product is
  // archived HAS a catalogue, and must get the filter bar rather than the
  // "add your first product" route.
  const catalogueIsEmpty = Object.values(totals).every((total) => total === 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product Catalogue"
        description={`${window.total.toLocaleString()} ${noun}`}
      />
      <SourcingInfoBanner>
        These are your real Sals3 product drafts. Publishing is not built yet,
        so nothing here is live on a storefront - and stock, media, and price
        facts that are not tracked yet say so instead of showing a guess.
      </SourcingInfoBanner>
      {catalogueIsEmpty ? (
        <CatalogueEmptyState />
      ) : (
        <>
          <CatalogueTabs
            active={query.status}
            totals={totals}
            currentParams={currentParams}
          />
          <RealCatalogueFilterBar
            query={query}
            current={currentParams}
            facets={facets}
          />
          <RealCatalogueWorkspace rows={views} />
        </>
      )}
      {window.totalPages > 1 ? (
        <PipelinePagination
          path={LISTINGS_PATH}
          page={window.page}
          totalPages={window.totalPages}
          total={window.total}
          currentParams={currentParams}
        />
      ) : null}
    </div>
  );
}
