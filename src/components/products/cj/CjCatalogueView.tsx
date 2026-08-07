import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { findEvaluationsByExternalIds } from '@/modules/catalog/candidates/queries';
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
} from '@/modules/suppliers/repository';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import { CjApiError } from '@/services/cj/config';
import type { CjQuery } from '@/lib/cj/schemas';
import CjErrorPanel from './CjErrorPanel';
import CjPagination from './CjPagination';
import CjProductsTable from './CjProductsTable';
import CjSearchInput from './CjSearchInput';
import SourcingEmptyState from './SourcingEmptyState';

type CjCatalogueViewProps = {
  query: CjQuery;
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
  const { sellerAccount } = await requireDropshipperAccount();

  if (!isDatabaseConfigured()) {
    return (
      <SourcingEmptyState
        title="No database configured in this environment"
        description="DATABASE_URL is not set here, so supplier connections cannot be read. This page works against a configured Postgres database - see the README."
      />
    );
  }

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

  let page;

  try {
    page = await adapter.listCandidates(connection.id, {
      page: query.cjPage,
      search: query.cjSearch,
      pid: query.cjPid,
    });
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
  };

  const evaluations = await findEvaluationsByExternalIds(
    sellerAccount.id,
    page.products.map((product) => product.id),
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-ink-muted">
        These are supplier products from CJdropshipping, read through your own
        connection ({connection.displayName}) - this is the optional raw
        browser. Prices are the supplier price in US dollars and are not
        converted to pesos. The automated evaluation pipeline picks up new and
        changed products on its own; the status column reflects that
        pipeline&apos;s current decision, not a manual check.
      </p>

      <CjSearchInput value={query.cjSearch} />

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
          <CjProductsTable products={page.products} evaluations={evaluations} />
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
