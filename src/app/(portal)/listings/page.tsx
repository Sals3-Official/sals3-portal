import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import ProductCatalogueWorkspace from '@/components/products/catalogue/ProductCatalogueWorkspace';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import { readOrUnavailable } from '@/lib/db/availability';
import { listCatalogueProductsForSeller } from '@/modules/catalog/products/read-model';

export const metadata: Metadata = {
  title: 'Product Catalogue · Sals3 Portal',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Product Catalogue.
 *
 * Reads persisted Sals3 Product/Variant/Offer/provider-reference rows. It does
 * not call any supplier API and does not promote imported drafts to live:
 * database publication gates remain the source of truth.
 */
export default async function ProductCataloguePage() {
  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Product Catalogue"
          description="Sals3-managed listings created after sourcing and customization. CJ remains the supplier - its facts are observed and protected, not manually invented."
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so Product Catalogue rows cannot be read."
        />
      </div>
    );
  }

  const resolved = await readOrUnavailable('product catalogue', async () => {
    const { sellerAccount } = await requireDropshipperAccount();

    return listCatalogueProductsForSeller(sellerAccount.id);
  });

  const products = resolved.ok ? resolved.data : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product Catalogue"
        description="Sals3-managed listings created after sourcing and customization. CJ remains the supplier - its facts are observed and protected, not manually invented."
      />
      {!resolved.ok ? (
        <SourcingEmptyState
          title="Cannot reach the database right now"
          description="Catalogue products could not be loaded because the database did not respond. No product, offer, or supplier evidence was changed."
        />
      ) : (
        <ProductCatalogueWorkspace initialProducts={products} />
      )}
    </div>
  );
}
