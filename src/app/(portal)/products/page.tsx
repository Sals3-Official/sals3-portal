import type { Metadata } from 'next';
import { Suspense } from 'react';
import PageHeader from '@/components/portal/PageHeader';
import CjCatalogueView from '@/components/products/cj/CjCatalogueView';
import CjTableSkeleton from '@/components/products/cj/CjTableSkeleton';
import { cjQuerySchema } from '@/lib/cj/schemas';

export const metadata: Metadata = {
  title: 'CJ Candidate Explorer · Sals3 Portal',
};

type ProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * CJ Candidate Explorer (spec section 8.13's product-facing name for this
 * screen). A Server Component that parses the URL and composes the
 * CJdropshipping supplier feed - the portal's only product source. No list
 * logic lives here. Unknown query keys (like the old ?source=cj) are
 * stripped by the schema, so old links keep working.
 *
 * The route stays `/products` on purpose: renaming it would break existing
 * links and the storefront feed's own references for a cosmetic gain.
 */
export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  const params = await searchParams;
  const cjQuery = cjQuerySchema.parse(params);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="CJ Candidate Explorer"
        description="Discover CJdropshipping products and shortlist candidates for Sals3"
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
