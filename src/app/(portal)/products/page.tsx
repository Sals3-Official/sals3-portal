import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';
import PageHeader from '@/components/portal/PageHeader';
import ProductSourceTabs from '@/components/products/ProductSourceTabs';
import Sals3CatalogueView from '@/components/products/Sals3CatalogueView';
import CjCatalogueView from '@/components/products/cj/CjCatalogueView';
import CjTableSkeleton from '@/components/products/cj/CjTableSkeleton';
import { can } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';
import { cjQuerySchema } from '@/lib/cj/schemas';
import { productListQuerySchema } from '@/lib/products/schemas';
import { listProducts } from '@/services/products';

export const metadata: Metadata = { title: 'Products · Sals3 Portal' };

type ProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Product list. A Server Component that parses the URL and composes one of two
 * views: the Sals3 catalogue, or the CJdropshipping supplier feed. No list logic
 * lives here.
 */
export default async function ProductsPage({
  searchParams,
}: ProductsPageProps) {
  const params = await searchParams;
  const source = params.source === 'cj' ? 'cj' : 'sals3';
  const session = await getSession();

  const actions = (
    <>
      {can(session.role, 'product:import') ? (
        <LinkButton href="/products/import" variant="outline">
          <Upload aria-hidden="true" />
          Import
        </LinkButton>
      ) : null}
      {can(session.role, 'product:export') ? (
        <LinkButton href="/products/export" variant="outline" prefetch={false}>
          <Download aria-hidden="true" />
          Export
        </LinkButton>
      ) : null}
      {can(session.role, 'product:create') ? (
        <LinkButton href="/products/new">
          <Plus aria-hidden="true" />
          Add product
        </LinkButton>
      ) : null}
    </>
  );

  if (source === 'cj') {
    const cjQuery = cjQuerySchema.parse(params);

    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Products"
          description="Supplier catalogue from CJdropshipping"
          actions={actions}
        />
        <ProductSourceTabs source="cj" />
        <Suspense
          key={`${cjQuery.cjPage}-${cjQuery.cjSearch}`}
          fallback={<CjTableSkeleton />}
        >
          <CjCatalogueView query={cjQuery} />
        </Suspense>
      </div>
    );
  }

  const query = productListQuerySchema.parse(params);
  const result = await listProducts(query);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Products"
        description={`${result.statusCounts.all} products in your catalogue`}
        actions={actions}
      />
      <ProductSourceTabs source="sals3" />
      <Sals3CatalogueView
        query={query}
        result={result}
        permissions={{
          canEdit: can(session.role, 'product:edit'),
          canCreate: can(session.role, 'product:create'),
          canPublish: can(session.role, 'product:publish'),
          canArchive: can(session.role, 'product:archive'),
          canDelete: can(session.role, 'product:delete'),
        }}
      />
    </div>
  );
}
