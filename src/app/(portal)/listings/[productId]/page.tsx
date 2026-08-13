import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import PageHeader from '@/components/portal/PageHeader';
import EditorSectionCard from '@/components/products/editor/EditorSectionCard';
import ProductSourcePanel from '@/components/products/editor/ProductSourcePanel';
import ProductVariantsPanel from '@/components/products/editor/ProductVariantsPanel';
import RealEditorWorkspace from '@/components/products/editor/RealEditorWorkspace';
import RealUnbuiltSection from '@/components/products/editor/RealUnbuiltSection';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import toReadinessIssues, {
  deriveMissingRequirements,
} from '@/lib/seller-center/product-editor/draft-readiness';
import resolveProductEditorData from '@/modules/catalog/products/editor-queries';
import {
  descriptionToText,
  isParagraphOnly,
  parseStoredDescription,
} from '@/modules/catalog/products/editor-view';

export const metadata: Metadata = {
  title: 'Edit product · Sals3 Portal',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * The REAL product editor: one steward-owned product out of the database, in the
 * seven-section layout the design specifies.
 *
 * A dynamic segment, not a query param - a real record is a resource with
 * identity, and the steward scope folds into the read so an unknown id and
 * another steward's id are one indistinguishable `notFound()`. The fictional
 * design preview stays at `/listings/new?fixture=`.
 *
 * Five of the seven sections are rendered HERE, as server slots handed to the
 * client shell. They hold no editable state, so keeping them out of the client
 * bundle costs nothing and makes the boundary obvious: what the shell owns is
 * exactly what a seller can change.
 */
export default async function ProductEditorPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;

  // A malformed id is a 404, not a 500 - and never reaches a uuid predicate.
  if (!z.string().uuid().safeParse(productId).success) notFound();

  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Edit product" description="Product Catalogue" />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so products cannot be read."
        />
      </div>
    );
  }

  const { sellerAccount } = await requireDropshipperAccount();
  const data = await resolveProductEditorData(sellerAccount.id, productId);

  if (data === null) notFound();

  const { document, parseFailed } = parseStoredDescription(
    data.draftRevision?.contentDocument ?? null,
  );
  const descriptionEditable =
    data.draftRevision !== null && !parseFailed && isParagraphOnly(document);
  const issues = toReadinessIssues(
    deriveMissingRequirements({
      categoryMappingConfidence: data.product.categoryMappingConfidence,
      variantCount: data.variants.length,
      descriptionDocument: document,
    }),
  );

  if (data.draftRevision === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={data.product.title}
          description="Product Catalogue"
        />
        <SourcingEmptyState
          title="No open draft revision"
          description="This product has no draft revision to edit. Its editorial record may be stewarded elsewhere."
        />
        <ProductSourcePanel reference={data.providerReference} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={data.product.title} description="Product Catalogue" />
      <RealEditorWorkspace
        productId={data.product.id}
        revisionId={data.draftRevision.id}
        revisionVersion={data.draftRevision.version}
        initialTitle={data.product.title}
        initialDescriptionText={descriptionToText(document)}
        descriptionEditable={descriptionEditable}
        storedDocument={document}
        issues={issues}
        basicFacts={
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-ink-muted">
                Sals3 category
              </span>
              <span className="text-sm">
                {data.product.categoryMappingConfidence === 'UNMAPPED'
                  ? 'Not mapped'
                  : data.product.categoryMappingConfidence}
              </span>
              <span className="text-xs text-ink-subtle">
                Category mapping is an authorized operator action, not a field
                here. Pricing stays unresolved until one exists.
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-ink-muted">Brand</span>
              <span className="text-sm">
                {data.product.brandName ?? 'Unbranded'}
              </span>
              <span className="text-xs text-ink-subtle">
                A brand is only ever set with real brand evidence (ADR-016), so
                there is no free-text field for it.
              </span>
            </div>
          </div>
        }
        specsSection={
          <RealUnbuiltSection
            id="specs"
            title="Specifications"
            explanation="Sals3 stores no product specifications. There is no specifications table in the schema, so there is nothing to show and nowhere to save one."
            nextStep="Specifications arrive with the attribute model that category mapping unlocks."
          />
        }
        variantsSection={
          <EditorSectionCard
            id="variants"
            title="Variants & Pricing"
            severity="BLOCKER"
            meta={
              <span className="text-xs text-ink-muted">
                {data.variants.length}{' '}
                {data.variants.length === 1 ? 'variant' : 'variants'}
              </span>
            }
          >
            <div className="flex flex-col gap-4">
              <ProductVariantsPanel variants={data.variants} />
              <ProductSourcePanel reference={data.providerReference} />
            </div>
          </EditorSectionCard>
        }
        marketsSection={
          <RealUnbuiltSection
            id="markets"
            title="Markets & Shipping"
            explanation="This account has no active market profile for an authorized destination, so no market offer exists and there is no shipping evidence to show."
            nextStep="Market profiles are configured outside this portal."
          />
        }
        mediaSection={
          <RealUnbuiltSection
            id="media"
            title="Media"
            explanation="No product media is recorded. The stored supplier evidence keeps a usable-image count, never the image addresses, so there is nothing to display, reorder, or pick a cover from."
            nextStep="Uploading and ordering media needs a media pipeline that does not exist yet."
          />
        }
      />
    </div>
  );
}
