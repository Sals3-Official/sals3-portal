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
 * All Supplier Products - the raw supplier catalogue browser.
 *
 * A Server Component that parses the URL and composes the local workspace.
 * Unknown query keys (the retired `?source=cj`, `?cjPage`, `?cjSearch`) are
 * stripped by the schema, so old links keep working and simply land on the
 * default view.
 *
 * The route stays `/products` on purpose: renaming it would break existing
 * links and the storefront feed's own references for a cosmetic gain.
 *
 * Rebuilt 2026-08-12 (ADR-013 §1a): this page used to call CJ
 * `/product/list` on every render. It now reads only what discovery has
 * already persisted, so browsing the catalogue costs no CJ API points.
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
        description="Everything discovery has found through your connected supplier apps. Screening runs automatically from saved supplier data; stock is confirmed only by a manual CJ/MyCJ check you record here."
      />
      <Suspense
        key={`${query.view}-${query.signal}-${query.category}-${query.q}-${query.page}-${query.source}`}
        fallback={<CjTableSkeleton />}
      >
        <SupplierProductsWorkspace query={query} />
      </Suspense>
    </div>
  );
}
