import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { findEvaluationsByExternalIds } from '@/modules/catalog/candidates/queries';
import { CjApiError } from '@/services/cj/config';
import { fetchCjProducts } from '@/services/cj/products';
import type { CjQuery } from '@/lib/cj/schemas';
import CjErrorPanel from './CjErrorPanel';
import CjPagination from './CjPagination';
import CjProductsTable from './CjProductsTable';
import CjSearchInput from './CjSearchInput';

type CjCatalogueViewProps = {
  query: CjQuery;
};

/**
 * The CJdropshipping catalogue view.
 *
 * An async Server Component, so the API key and the access token stay on the
 * server and the browser receives only the rendered rows. A failure upstream
 * turns into one plain message here instead of taking the page down.
 */
export default async function CjCatalogueView({ query }: CjCatalogueViewProps) {
  let page;

  try {
    page = await fetchCjProducts(query);
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

  const session = await requirePermission('product:read');
  const evaluations = isDatabaseConfigured()
    ? await findEvaluationsByExternalIds(
        session.sellerId,
        page.products.map((product) => product.id),
      )
    : new Map();

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-ink-muted">
        These are supplier products from CJdropshipping - this is the optional
        raw browser. Prices are the supplier price in US dollars and are not
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
