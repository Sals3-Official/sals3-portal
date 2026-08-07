import type { Metadata } from 'next';
import { Suspense } from 'react';
import PageHeader from '@/components/portal/PageHeader';
import CjCatalogueView from '@/components/products/cj/CjCatalogueView';
import CjTableSkeleton from '@/components/products/cj/CjTableSkeleton';
import { productsPageQuerySchema } from '@/lib/cj/schemas';

export const metadata: Metadata = {
  title: 'All Supplier Products · Sals3 Portal',
};

type ProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * All Supplier Products - the optional raw CJ browser (nav label; formerly
 * "CJ Candidate Explorer"). A Server Component that parses the URL and
 * composes the CJdropshipping supplier feed - the portal's only product
 * source. No list logic lives here. Unknown query keys (like the old
 * ?source=cj) are stripped by the schema, so old links keep working.
 *
 * The route stays `/products` on purpose: renaming it would break existing
 * links and the storefront feed's own references for a cosmetic gain. The
 * automated pipeline (`src/modules/catalog/candidates/run-tick.ts`) ingests
 * from this same feed on its own; this page is for browsing, not driving
 * that pipeline.
 */
export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  const params = await searchParams;
  const cjQuery = productsPageQuerySchema.parse(params);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="All Supplier Products"
        description="Browse products from your connected supplier apps. Automated evaluation runs in the background."
      />
      <Suspense
        key={`${cjQuery.cjPage}-${cjQuery.cjSearch}`}
        fallback={<CjTableSkeleton />}
      >
        <CjCatalogueView query={cjQuery} />
      </Suspense>
    </div>
  );
}
