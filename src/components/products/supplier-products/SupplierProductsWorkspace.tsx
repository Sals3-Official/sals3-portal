import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { can } from '@/lib/auth/permissions';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import {
  QUICK_VIEW_ORDERING,
  type SupplierProductsQuery,
} from '@/lib/products/supplier-products-params';
import {
  loadLiveBrowsePage,
  type LiveBrowseErrorState,
} from '@/modules/catalog/candidates/live-browse';
import { findSupplierProductForSeller } from '@/modules/catalog/candidates/supplier-products-queries';
import { listStockAttestations } from '@/modules/catalog/candidates/stock-review-repository';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { CJ_ERROR_MESSAGES } from '@/services/cj/config';
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
 * One plain sentence per failure state - the detail stays in the server log,
 * never in the response.
 */
function LiveBrowseErrorNotice({ state }: { state: LiveBrowseErrorState }) {
  if (state === 'no-connection') {
    return (
      <SourcingEmptyState
        title="No CJ connection yet"
        description="Connect a CJdropshipping account under Supplier Apps to browse its live catalogue here."
      />
    );
  }

  if (state === 'reauth-required') {
    return (
      <SourcingEmptyState
        title="Your CJ connection needs attention"
        description={CJ_ERROR_MESSAGES['authentication-failed']}
      />
    );
  }

  if (state === 'rate-limited') {
    return (
      <SourcingEmptyState
        title="CJ is limiting requests right now"
        description={CJ_ERROR_MESSAGES['rate-limited']}
      />
    );
  }

  if (state === 'throttled-locally') {
    return (
      <SourcingEmptyState
        title="Browsing too fast"
        description="This page is briefly paused to protect your CJ API budget. Wait a moment, then reload or continue browsing."
      />
    );
  }

  return (
    <SourcingEmptyState
      title="CJ did not answer"
      description={CJ_ERROR_MESSAGES['upstream-unavailable']}
    />
  );
}

/**
 * All Supplier Products - a live CJ `/product/list` browse (owner decision
 * 2026-08-13, superseding the ADR-013 §1a saved-data read for THIS page
 * only).
 *
 * Every render makes exactly one live `/product/list` request through the
 * seller's own CJ connection, plus an hourly-cached category tree read. The
 * Sals3 database supplies only the pipeline overlay: which live rows are
 * already discovered candidates, their screening state, signals, and manual
 * stock review. Browsing performs ZERO writes - it never creates, refreshes,
 * or evaluates a candidate; the discovery workers remain the only writers.
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
        description="DATABASE_URL is not set here, so your CJ connection cannot be resolved. This page works against a configured Postgres database - see the README."
      />
    );
  }

  const { session, sellerAccount } = await requireDropshipperAccount();

  const secretStore = new PostgresSupplierSecretStore();
  const adapter = new CjSupplierAdapter(
    secretStore,
    new CjTokenManager(secretStore),
  );

  const ordering = QUICK_VIEW_ORDERING[query.view];
  const result = await loadLiveBrowsePage(
    { adapter },
    {
      sellerAccountId: sellerAccount.id,
      userId: session.userId,
      query: {
        page: query.page,
        search: query.q,
        categoryId: query.category,
        ...(ordering ?? {}),
      },
    },
  );

  if (!result.ok) {
    return <LiveBrowseErrorNotice state={result.state} />;
  }

  const { page } = result;

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

  const currentParams: Record<string, string> = {
    ...(query.view === 'all' ? {} : { view: query.view }),
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
      />

      {/* `items-start`, not `items-end`: the search column carries a hint line
          under its input, so bottom alignment would drop the category select
          below the input it sits beside. */}
      <div className="flex flex-wrap items-start gap-3">
        <SupplierProductsSearchInput value={query.q} />
        <SupplierProductsFilterSelect
          id="category-filter"
          label="Category"
          param="category"
          clearedValue=""
          value={query.category}
          options={[
            { value: '', label: 'All categories' },
            ...page.categories.map((category) => ({
              value: category.categoryId,
              label:
                category.path.length === 0
                  ? category.categoryName
                  : `${category.path.join(' › ')} › ${category.categoryName}`,
            })),
          ]}
        />
      </div>

      {page.rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
          <h2 className="font-display text-lg font-semibold">
            No CJ products match this view
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            CJ returned no products for this page, search, or category. Clear
            the search or filters, or go back a page.
          </p>
        </div>
      ) : (
        <>
          <SupplierProductsTable rows={page.rows} />
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
