import type { Metadata } from 'next';
import { FlaskConical } from 'lucide-react';
import PageHeader from '@/components/portal/PageHeader';
import ProductCatalogueWorkspace from '@/components/products/catalogue/ProductCatalogueWorkspace';
import { requirePermission } from '@/lib/auth/session';
import { listCatalogueFixtures } from '@/lib/seller-center/mock-data/product-catalogue';

export const metadata: Metadata = {
  title: 'Product Catalogue preview · Sals3 Portal',
  robots: { index: false, follow: false },
};

/**
 * The Product Catalogue DESIGN PREVIEW, relocated from `/listings` when that
 * route became the real database-backed catalogue.
 *
 * Kept because it is the reviewed design artifact for the full ADR-011
 * lifecycle (Live · Needs Attention, Auto-paused, availability states, media
 * status, rich filters) - none of which the database backs yet. Everything
 * here is a real client interaction over an in-memory fixture list; nothing
 * reads or writes a database, and a reload discards every change.
 */
export default async function ProductCataloguePreviewPage() {
  await requirePermission('product:read');

  const products = listCatalogueFixtures();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product Catalogue (design preview)"
        description="The full-lifecycle catalogue design against fictional data. The real catalogue lives at /listings."
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
          UI preview using fictional listing data. Changes are not saved.
          <span className="block text-xs text-ink-muted">
            Pause is real in-memory state; publish and resume stay
            disabled/unbuilt because they need server-side gates this preview
            does not have.
          </span>
        </span>
      </p>

      <ProductCatalogueWorkspace initialProducts={products} />
    </div>
  );
}
