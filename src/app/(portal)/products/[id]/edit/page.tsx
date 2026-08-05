import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import NoAccess from '@/components/portal/NoAccess';
import PageHeader from '@/components/portal/PageHeader';
import ProductForm from '@/components/products/form/ProductForm';
import { can } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';
import { getProduct } from '@/services/products';

export const metadata: Metadata = { title: 'Edit product · Sals3 Portal' };

type EditProductPageProps = {
  params: Promise<{ id: string }>;
};

/** Edit product. The form is the same component the add page uses. */
export default async function EditProductPage({
  params,
}: EditProductPageProps) {
  const { id } = await params;
  const session = await getSession();

  if (!can(session.role, 'product:edit')) {
    return <NoAccess role={session.role} action="edit products" />;
  }

  const product = await getProduct(id);

  if (product === null) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit product"
        description={`${product.name} · last updated ${product.updatedAt} by ${product.updatedBy}`}
      />
      <ProductForm product={product} />
    </div>
  );
}
