import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import DescriptionStudioClient from '@/components/products/description-studio/DescriptionStudioClient';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { findProductEditorFixtureForSeller } from '@/modules/catalog/products/read-model';

/**
 * The description editor, on its own screen.
 *
 * Authorization is the same pair the listing editor uses and is resolved here,
 * on the server: `product:edit` plus the ADR-006 Dropshipper check. The seller
 * account comes from the session and the product is looked up *within* it, so a
 * `productId` belonging to another tenant is indistinguishable from one that
 * never existed — a `notFound()` either way, costing the same single read.
 *
 * Only a product with an open `DRAFT` revision can be edited. A submitted or
 * approved revision is not editable in place at all (ADR-007 invariant 3), so
 * there is no target to compare-and-set against and this route refuses rather
 * than rendering a canvas whose save could never succeed.
 */

const paramsSchema = z.object({ productId: z.string().uuid() });

type PageProps = {
  params: Promise<{ productId: string }>;
};

export const metadata: Metadata = {
  title: 'Description · Seller Center',
  robots: { index: false, follow: false },
};

export default async function DescriptionStudioPage({ params }: PageProps) {
  const parsed = paramsSchema.safeParse(await params);

  if (!parsed.success) notFound();

  await requirePermission('product:edit');

  if (!isDatabaseConfigured()) notFound();

  // Resolves the tenant itself and throws `PermissionError` for any account
  // that is not an active, verified Dropshipper — the seller account is never
  // taken from the request.
  const { sellerAccount } = await requireDropshipperAccount();
  const record = await findProductEditorFixtureForSeller(
    sellerAccount.id,
    parsed.data.productId,
  );

  if (record === null) notFound();

  const { fixture } = record;
  const target = fixture.draftSaveTarget;

  // No open `DRAFT` revision means no version to compare-and-set against, so
  // the canvas would render over a save that could never succeed.
  if (target === null) notFound();

  return (
    <DescriptionStudioClient
      productName={fixture.productName}
      productId={target.productId}
      revisionId={target.revisionId}
      expectedRevisionVersion={target.expectedRevisionVersion}
      backHref={`/listings/new?productId=${target.productId}`}
      initialBlocks={fixture.descriptionBlocks}
    />
  );
}
