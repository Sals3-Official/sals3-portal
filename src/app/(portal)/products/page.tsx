import type { Metadata } from 'next';
import { Suspense } from 'react';
import PageHeader from '@/components/portal/PageHeader';
import CjCatalogueView from '@/components/products/cj/CjCatalogueView';
import CjTableSkeleton from '@/components/products/cj/CjTableSkeleton';
import { cjQuerySchema } from '@/lib/cj/schemas';

export const metadata: Metadata = { title: 'Products · Sals3 Portal' };

type ProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Product list. A Server Component that parses the URL and composes the
 * CJdropshipping supplier feed - the portal's only product source. No list
 * logic lives here. Unknown query keys (like the old ?source=cj) are
 * stripped by the schema, so old links keep working.
 */
export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  const params = await searchParams;
  const cjQuery = cjQuerySchema.parse(params);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Products"
        description="Supplier catalogue from CJdropshipping"
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
