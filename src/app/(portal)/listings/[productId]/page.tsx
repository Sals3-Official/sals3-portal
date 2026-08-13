import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import PageHeader from '@/components/portal/PageHeader';
import DraftRequirementsPanel from '@/components/products/editor/DraftRequirementsPanel';
import ProductSourcePanel from '@/components/products/editor/ProductSourcePanel';
import ProductVariantsPanel from '@/components/products/editor/ProductVariantsPanel';
import RealProductEditor from '@/components/products/editor/RealProductEditor';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
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
 * The REAL product editor: one steward-owned product out of the database.
 *
 * A dynamic segment, not a query param - a real record is a resource with
 * identity, and the steward scope folds into the read so an unknown id and
 * another steward's id are one indistinguishable `notFound()`. The fixture
 * design preview stays at `/listings/new?fixture=`.
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={data.product.title} description="Product Catalogue" />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          {data.draftRevision === null ? (
            <SourcingEmptyState
              title="No open draft revision"
              description="This product has no draft revision to edit. Its editorial record may be stewarded elsewhere."
            />
          ) : (
            <RealProductEditor
              productId={data.product.id}
              revisionId={data.draftRevision.id}
              revisionVersion={data.draftRevision.version}
              initialTitle={data.product.title}
              initialDescriptionText={descriptionToText(document)}
              descriptionEditable={descriptionEditable}
              storedDocument={document}
            />
          )}
          <ProductVariantsPanel variants={data.variants} />
        </div>
        <div className="flex flex-col gap-6">
          <DraftRequirementsPanel
            product={data.product}
            variants={data.variants}
            descriptionDocument={document}
          />
          <ProductSourcePanel reference={data.providerReference} />
        </div>
      </div>
    </div>
  );
}
