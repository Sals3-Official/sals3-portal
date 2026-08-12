import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { readOrUnavailable } from '@/lib/db/availability';
import { can } from '@/lib/auth/permissions';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import {
  QUICK_VIEW_LABELS,
  SIGNAL_FILTER_LABELS,
  DISCOVERY_SIGNAL_FILTERS,
  type SupplierProductsQuery,
} from '@/lib/products/supplier-products-params';
import {
  findSupplierProductForSeller,
  listSupplierProductCategories,
  listSupplierProducts,
  summariseSupplierProducts,
} from '@/modules/catalog/candidates/supplier-products-queries';
import { listStockAttestations } from '@/modules/catalog/candidates/stock-review-repository';
import SupplierProductsFilterSelect from './SupplierProductsFilterSelect';
import SupplierProductsPagination from './SupplierProductsPagination';
import SupplierProductsQuickViews from './SupplierProductsQuickViews';
import SupplierProductsSearchInput from './SupplierProductsSearchInput';
import SupplierProductsTable from './SupplierProductsTable';
import SupplierSourceDetailsPanel from './SupplierSourceDetailsPanel';

type SupplierProductsWorkspaceProps = {
  query: SupplierProductsQuery;
};

/**
 * All Supplier Products, served entirely from the Sals3 database.
 *
 * This component replaced a version that called CJ `/product/list` on every
 * render, so every page view, search keystroke, filter change, page turn, and
 * drawer open spent supplier points. Under the owner's CJ call-budget
 * decision none of those may contact CJ, and the way that is guaranteed here
 * is structural: this subtree imports no supplier adapter, token manager, or
 * secret store, so there is nothing in it that *could* make a supplier call.
 *
 * Discovery still populates these rows in the background, bounded by the
 * one-time backlog drain gate and the owner's new-PID intake ceiling.
 */
export default async function SupplierProductsWorkspace({
  query,
}: SupplierProductsWorkspaceProps) {
  // Checked before `requireDropshipperAccount()`: that call reaches the
  // database immediately, and an environment with no `DATABASE_URL` (a Vercel
  // preview, CI) must degrade honestly rather than crash the page.
  if (!isDatabaseConfigured()) {
    return (
      <SourcingEmptyState
        title="No database configured in this environment"
        description="DATABASE_URL is not set here, so your supplier products cannot be read. This page works against a configured Postgres database - see the README."
      />
    );
  }

  // Authorization and reads share one guard on purpose. Resolving the seller
  // account is itself a query, so protecting only the reads below still leaves
  // the page crashing one line earlier - which is exactly what a dropped local
  // database did to it. `readOrUnavailable` rethrows anything that is not
  // genuine unavailability, so a PermissionError still denies access and a
  // missing table still surfaces as the migration bug it is.
  const resolved = await readOrUnavailable('supplier products', async () => {
    const { session, sellerAccount } = await requireDropshipperAccount();

    const filters = {
      quickView: query.view,
      signal: query.signal,
      categoryId: query.category === '' ? null : query.category,
      search: query.q,
      page: query.page,
    } as const;

    const [page, categories, summary] = await Promise.all([
      listSupplierProducts(sellerAccount.id, filters),
      listSupplierProductCategories(sellerAccount.id),
      summariseSupplierProducts(sellerAccount.id),
    ]);

    const openProduct =
      query.source === ''
        ? null
        : await findSupplierProductForSeller(sellerAccount.id, query.source);
    const attestations =
      openProduct === null
        ? []
        : await listStockAttestations(getDb(), {
            candidateId: openProduct.candidateId,
            sellerAccountId: sellerAccount.id,
          });

    return { session, page, categories, summary, openProduct, attestations };
  });

  if (!resolved.ok) {
    return (
      <SourcingEmptyState
        title="Cannot reach the database right now"
        description="Your supplier products could not be loaded because the database did not respond. Nothing has been lost - this page reads saved Sals3 data and makes no supplier request. Check that Postgres is running and that DATABASE_URL points at an existing database, then reload."
      />
    );
  }

  const { session, page, categories, summary, openProduct, attestations } =
    resolved.data;

  const currentParams: Record<string, string> = {
    ...(query.view === 'all' ? {} : { view: query.view }),
    ...(query.signal === 'ALL' ? {} : { signal: query.signal }),
    ...(query.category === '' ? {} : { category: query.category }),
    ...(query.q === '' ? {} : { q: query.q }),
    ...(query.page === 1 ? {} : { page: String(query.page) }),
    ...(query.source === '' ? {} : { source: query.source }),
  };

  return (
    <div className="flex flex-col gap-4">
      <SupplierProductsQuickViews
        active={query.view}
        currentParams={currentParams}
        needsAttentionCount={summary.needsAttention}
      />

      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-ink-muted">
        {summary.total} product{summary.total === 1 ? '' : 's'} discovered from
        your connected supplier apps · {summary.stockNotChecked} not yet
        stock-checked · {summary.manuallyInStock} manually confirmed in stock.
        Browsing, searching, filtering, paging, and opening source details all
        read saved Sals3 data and make no supplier request. Stock is confirmed
        only by a person recording a CJ/MyCJ inspection.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <SupplierProductsSearchInput value={query.q} />
        <SupplierProductsFilterSelect
          id="discovery-signal-filter"
          label="Discovery signal"
          param="signal"
          clearedValue="ALL"
          value={query.signal}
          options={DISCOVERY_SIGNAL_FILTERS.map((value) => ({
            value,
            label: SIGNAL_FILTER_LABELS[value],
          }))}
        />
        <SupplierProductsFilterSelect
          id="category-filter"
          label="Category"
          param="category"
          clearedValue=""
          value={query.category}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((category) => ({
              value: category.id,
              label: `${category.name} (${category.total})`,
            })),
          ]}
        />
      </div>

      {page.rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
          <h2 className="font-display text-lg font-semibold">
            {summary.total === 0
              ? 'No supplier products discovered yet'
              : 'No products match these filters'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {summary.total === 0
              ? 'Connect a CJ Dropshipping account under Supplier Apps, then start discovery. Products appear here as they are found.'
              : `Clear the ${QUICK_VIEW_LABELS[query.view]} view, the filters, or the search to see more.`}
          </p>
        </div>
      ) : (
        <>
          <SupplierProductsTable
            rows={page.rows}
            currentParams={currentParams}
          />
          <SupplierProductsPagination
            page={page.page}
            totalPages={page.totalPages}
            total={page.total}
            pageSize={page.pageSize}
            currentParams={currentParams}
          />
        </>
      )}

      {openProduct === null ? null : (
        <SupplierSourceDetailsPanel
          product={openProduct}
          attestations={attestations}
          currentParams={currentParams}
          canAttest={can(session.role, 'catalog.candidate.stock_attest')}
        />
      )}
    </div>
  );
}
