import type { Metadata } from 'next';
import { FlaskConical } from 'lucide-react';
import PageHeader from '@/components/portal/PageHeader';
import ProductCatalogueWorkspace from '@/components/products/catalogue/ProductCatalogueWorkspace';
import { requirePermission } from '@/lib/auth/session';
import { listCatalogueFixtures } from '@/lib/seller-center/mock-data/product-catalogue';

export const metadata: Metadata = {
  title: 'Product Catalogue · Sals3 Portal',
  robots: { index: false, follow: false },
};

/**
 * Product Catalogue design preview.
 *
 * Sals3 has no writable catalogue yet (no Product/Variant/Offer table -
 * see [[cj-candidate-to-sals3-product-draft-implementation-spec]]), so this
 * screen is a fictional-fixture UI review, the same posture the Product
 * Editor already uses at `/listings/new?fixture=`. Tabs, search, sort,
 * bulk selection, row expansion, and the active toggles are real client
 * interactions over an in-memory fixture list; "Edit" opens the real
 * Product Editor against one of its existing fixtures. Nothing here reads
 * or writes a database, and a reload discards every change.
 */
export default async function ProductCataloguePage() {
  await requirePermission('product:read');

  const products = listCatalogueFixtures();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product Catalogue"
        description="The seller's authoritative list of Sals3 listings."
      />
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg border border-primary/20 bg-accent px-3 py-2 text-sm text-brand-900"
      >
        <FlaskConical
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-primary"
        />
        <span>
          UI preview using fictional product data. Changes are not saved.
          <span className="block text-xs text-ink-muted">
            No writable Sals3 catalogue exists yet - units sold, wishlist,
            views, rating, and content score have no real backend.
          </span>
        </span>
      </p>

      <ProductCatalogueWorkspace initialProducts={products} />
    </div>
  );
}
