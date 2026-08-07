import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { resolveUsdToPhpRate } from '@/lib/storefront/fx';
import { resolveUsdToAudMidRate } from '@/lib/products/catalog-fx';
import type { CatalogFxRates } from '@/lib/products/catalog-types';
import { findEvaluationsByExternalIds } from '@/modules/catalog/candidates/queries';
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
} from '@/modules/suppliers/repository';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import { CjApiError } from '@/services/cj/config';
import type { ProductsPageQuery } from '@/lib/cj/schemas';
import CjErrorPanel from './CjErrorPanel';
import CjPagination from './CjPagination';
import CjProductGrid from './CjProductGrid';
import CjProductsTable from './CjProductsTable';
import CjSearchInput from './CjSearchInput';
import CjStatHeader from './CjStatHeader';
import CjViewToggle from './CjViewToggle';
import SourcingEmptyState from './SourcingEmptyState';

type CjCatalogueViewProps = {
  query: ProductsPageQuery;
};

/**
 * The CJdropshipping catalogue view (ADR-008: the seller's own connection,
 * not the retired global `CJ_API_KEY` path - see spec section 26's
 * "application runtime must not use CJ_API_KEY" rule). An async Server
 * Component, so the connection's decrypted token stays on the server and
 * the browser receives only the rendered rows. A failure upstream turns
 * into one plain message here instead of taking the page down.
 */
export default async function CjCatalogueView({ query }: CjCatalogueViewProps) {
  // Checked before `requireDropshipperAccount()` on purpose - that call
  // reaches the database immediately, and an environment with no
  // `DATABASE_URL` (a Vercel preview, CI) must degrade honestly here rather
  // than let an uncaught "DATABASE_URL is not set" crash the page.
  if (!isDatabaseConfigured()) {
    return (
      <SourcingEmptyState
        title="No database configured in this environment"
        description="DATABASE_URL is not set here, so supplier connections cannot be read. This page works against a configured Postgres database - see the README."
      />
    );
  }

  const { sellerAccount } = await requireDropshipperAccount();
  const provider = await findProviderByCode(getDb(), 'CJ_DROPSHIPPING');
  const connection =
    provider === null
      ? null
      : await findConnectionBySellerAndProvider(
          getDb(),
          sellerAccount.id,
          provider.id,
        );

  if (
    provider === null ||
    connection === null ||
    connection.status === 'REVOKED' ||
    connection.status === 'DISCONNECTED'
  ) {
    return (
      <SourcingEmptyState
        title="No CJ connection yet"
        description="Connect a CJ Dropshipping account under Supplier Apps to browse and automatically evaluate its catalogue."
      />
    );
  }

  const secretStore = new PostgresSupplierSecretStore();
  const adapter = new CjSupplierAdapter(
    secretStore,
    new CjTokenManager(secretStore),
  );

  // Every provider's connection identity, permanent wherever a product from
  // it appears later (spec section 8) - built once here rather than passed
  // around as raw `SupplierConnectionRow` + `SupplierProviderRow` fields.
  const connectionIdentity = {
    id: connection.id,
    providerCode: provider.code,
    providerDisplayName: provider.displayName,
    providerLogoInitial: provider.code.slice(0, 2).toUpperCase(),
    connectedAccountLabel: connection.displayName,
    status: connection.status,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
  };

  let page;
  let usdToPhpRate;
  let usdToAudMidRate;

  try {
    [page, usdToPhpRate, usdToAudMidRate] = await Promise.all([
      adapter.listCandidates(connection.id, {
        page: query.cjPage,
        search: query.cjSearch,
        pid: query.cjPid,
      }),
      resolveUsdToPhpRate(),
      resolveUsdToAudMidRate(),
    ]);
  } catch (error) {
    if (error instanceof CjApiError) {
      // Structured server-side log; the response carries only the reason code.
      // eslint-disable-next-line no-console
      console.error('[portal] CJ product list failed', error.reason);

      return <CjErrorPanel reason={error.reason} />;
    }

    throw error;
  }

  const currentParams = {
    cjPage: String(page.page),
    cjSearch: query.cjSearch,
    view: query.view,
  };

  const evaluations = await findEvaluationsByExternalIds(
    sellerAccount.id,
    page.products.map((product) => product.id),
  );

  const rates: CatalogFxRates = {
    USD: {
      effectiveRate: usdToPhpRate.effective,
      fetchedAt: usdToPhpRate.fetchedAt.toISOString(),
      stale: usdToPhpRate.stale,
    },
  };

  const fxAgeMinutes = Math.max(
    0,
    Math.round((Date.now() - usdToPhpRate.fetchedAt.getTime()) / 60_000),
  );
  const fxUpdatedLabel =
    fxAgeMinutes < 60
      ? `${fxAgeMinutes}m ago`
      : `${Math.round(fxAgeMinutes / 60)}h ago`;

  return (
    <div className="flex flex-col gap-3">
      <CjStatHeader
        totalProducts={page.total}
        productsOnPage={page.products.length}
        activeConnections={1}
        fxUpdatedLabel={fxUpdatedLabel}
      />

      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-ink-muted">
        Products shown here come from your active supplier connections -
        currently {connection.displayName} ({provider.displayName}). This is the
        optional raw browser; the automated evaluation pipeline picks up new and
        changed products on its own, and the status column reflects that
        pipeline&apos;s current decision, not a manual check. Prices are the
        supplier price; the peso amount is an estimate, never the final landed
        cost.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <CjSearchInput value={query.cjSearch} />
        <div className="ml-auto">
          <CjViewToggle value={query.view} />
        </div>
      </div>

      {page.products.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
          <h2 className="font-display text-lg font-semibold">
            No supplier products match that search
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try fewer words, or search in English.
          </p>
        </div>
      ) : (
        <>
          {query.view === 'grid' ? (
            <CjProductGrid
              products={page.products}
              evaluations={evaluations}
              connection={connectionIdentity}
              rates={rates}
              usdToAudRate={usdToAudMidRate?.rate ?? null}
            />
          ) : (
            <CjProductsTable
              products={page.products}
              evaluations={evaluations}
              connection={connectionIdentity}
              rates={rates}
              usdToAudRate={usdToAudMidRate?.rate ?? null}
            />
          )}
          <CjPagination
            page={page.page}
            totalPages={page.totalPages}
            total={page.total}
            currentParams={currentParams}
          />
        </>
      )}
    </div>
  );
}
