import type { Metadata } from 'next';
import NoAccess from '@/components/portal/NoAccess';
import PageHeader from '@/components/portal/PageHeader';
import ProductForm from '@/components/products/form/ProductForm';
import { can } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Add product · Sals3 Portal' };

/**
 * Add product. The permission is checked here and again inside the create
 * action, so opening this URL directly changes nothing for a role that cannot
 * create products.
 */
export default async function NewProductPage() {
  const session = await getSession();

  if (!can(session.role, 'product:create')) {
    return <NoAccess role={session.role} action="add products" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Add product"
        description="A new product starts as a draft. Send it for review when it is ready."
      />
      <ProductForm product={null} />
    </div>
  );
}
