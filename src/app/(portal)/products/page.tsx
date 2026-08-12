import type { Metadata } from 'next';
import { Suspense } from 'react';
import PageHeader from '@/components/portal/PageHeader';
import CjTableSkeleton from '@/components/products/cj/CjTableSkeleton';
import SupplierProductsWorkspace from '@/components/products/supplier-products/SupplierProductsWorkspace';
import { supplierProductsQuerySchema } from '@/lib/products/supplier-products-params';

export const metadata: Metadata = {
  title: 'All Supplier Products · Sals3 Portal',
};

type ProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * All Supplier Products - the live supplier catalogue browser.
 *
 * A Server Component that parses the URL and composes the workspace. Unknown
 * query keys (the retired `?signal`, `?source=cj`, `?cjPage`, `?cjSearch`)
 * are stripped by the schema, so old links keep working and simply land on
 * the default view.
 *
 * The route stays `/products` on purpose: renaming it would break existing
 * links and the storefront feed's own references for a cosmetic gain.
 *
 * Rebuilt 2026-08-13 by owner decision: the table shows live CJ
 * `/product/list` results (200 per page) on every render, overlaid with this
 * seller's own pipeline state from the Sals3 database. This supersedes the
 * 2026-08-12 saved-data read for this page only - the discovery pipeline and
 * its pages are unchanged, and browsing never writes to them.
 */
export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  const params = await searchParams;
  const query = supplierProductsQuerySchema.parse(params);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="All Supplier Products"
        description="The live CJdropshipping catalogue through your connected supplier app. Rows already picked up by discovery show their screening and stock-review state; stock is confirmed only by a manual CJ/MyCJ check you record here."
      />
      <Suspense
        key={`${query.view}-${query.category}-${query.q}-${query.page}-${query.source}`}
        fallback={<CjTableSkeleton />}
      >
        <SupplierProductsWorkspace query={query} />
      </Suspense>
    </div>
  );
}
