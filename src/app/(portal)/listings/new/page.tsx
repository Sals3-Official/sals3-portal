import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import LinkButton from '@/components/portal/LinkButton';
import PageHeader from '@/components/portal/PageHeader';
import ProductEditor from '@/components/products/editor/ProductEditor';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import AddProductModeChooser from '@/components/seller-center/listings/AddProductModeChooser';
import BlankListingWorkspace from '@/components/seller-center/listings/BlankListingWorkspace';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { requirePermission } from '@/lib/auth/session';
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import resolveFixtureVariantGuidance from '@/lib/seller-center/product-editor/pricing-guidance';
import {
  editorLifecycleParamSchema,
  lifecycleFromParam,
} from '@/lib/seller-center/product-editor/query';
import { findProductEditorFixtureForSeller } from '@/modules/catalog/products/read-model';

/**
 * Add Product. One route, two entry modes:
 *
 * - no query    - the blank essentials-first wizard.
 * - `?fixture=` - the Product Editor design preview, prefilled from a
 *                 fictional qualified supplier product. Development only.
 * - `?productId=` - persisted Product Catalogue record, rendered into the
 *                 same editor UI from database data.
 * - `?supplierCandidateId=` - reserved for the real integration. It is
 *                 parsed and acknowledged, never answered with fixture
 *                 data, because a real candidate id must not resolve to a
 *                 fictional product.
 *
 * Kept to composition and authorization: every branch below is its own
 * component, and the interactive state lives inside `ProductEditor`.
 */

const querySchema = z.object({
  fixture: z.string().max(64).optional().catch(undefined),
  productId: z.string().uuid().optional().catch(undefined),
  supplierCandidateId: z.string().max(128).optional().catch(undefined),
  state: editorLifecycleParamSchema,
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The fixture and reserved-integration modes are explicitly de-indexed.
 * They render fictional or placeholder content on a real production route,
 * and a crawler that indexed either would put an invented product - or a
 * "not wired up yet" page carrying a candidate id - into search results.
 */
export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const query = querySchema.parse(await searchParams);
  const isPreview =
    query.fixture !== undefined ||
    query.productId !== undefined ||
    query.supplierCandidateId !== undefined;

  return {
    title: 'Add Product · Sals3 Portal',
    robots: isPreview ? { index: false, follow: false } : undefined,
  };
}

/*
 * There is deliberately no `loading.tsx` on this route.
 *
 * Adding one puts the segment behind a Suspense boundary, so Next streams
 * the shell and commits a `200` before the page body runs. `notFound()`
 * then renders the 404 *page* under a `200` *status* - measured, not
 * assumed - which would let an unknown fixture key, or a real candidate id
 * passed as one, answer as if it existed. A skeleton is not worth a route
 * that lies about whether its content is there. Revisit if the editor ever
 * gains slow real data worth streaming: validate the key in a parent
 * segment first, then stream below it.
 */

export default async function AddProductPage({ searchParams }: PageProps) {
  // Authorization runs on the server before anything is read or rendered.
  // Hiding a nav link is never the check - see `src/lib/auth/permissions.ts`.
  const session = await requirePermission('product:create');

  const query = querySchema.parse(await searchParams);

  if (query.supplierCandidateId !== undefined) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Add Product"
          description="Prefilled from a qualified supplier product"
        />
        <SourcingEmptyState
          title="Listing a real supplier candidate is not wired up yet"
          description="This screen exists as a design preview only. It will not open a real candidate against fictional data, because that would misrepresent your product. Use Qualified Products to review candidates in the meantime."
        />
        <div>
          <LinkButton href="/products/pipeline?tab=ready" variant="outline">
            Go to Qualified Products
          </LinkButton>
        </div>
      </div>
    );
  }

  if (query.fixture !== undefined) {
    const fixture = resolveProductEditorFixture(query.fixture);

    // An unknown key - including a real candidate id - is a 404, never a
    // silent fallback to a default fictional product.
    if (fixture === null) notFound();

    const variantGuidance = await resolveFixtureVariantGuidance(
      fixture,
      session.sellerId,
    );

    return (
      <ProductEditor
        fixture={fixture}
        initialLifecycle={lifecycleFromParam(query.state)}
        variantGuidance={variantGuidance}
      />
    );
  }

  if (query.productId !== undefined) {
    const { sellerAccount } = await requireDropshipperAccount();
    const record = await findProductEditorFixtureForSeller(
      sellerAccount.id,
      query.productId,
    );

    if (record === null) notFound();

    return (
      <ProductEditor
        fixture={record.fixture}
        initialLifecycle={lifecycleFromParam(query.state)}
        variantGuidance={record.variantGuidance}
        dataMode="database"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Add Product"
        description="Essentials first. Requirements appear when they apply to you."
      />
      <AddProductModeChooser />
      <BlankListingWorkspace />
    </div>
  );
}
