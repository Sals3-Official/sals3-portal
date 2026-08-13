import { eq, inArray } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  providerProductReferences,
  providerVariantReferences,
  supplierProviders,
  type ProductRevisionRow,
  type ProductRow,
  type ProductVariantRow,
  type ProviderProductReferenceRow,
  type ProviderVariantReferenceRow,
} from '@/lib/db/schema';
import {
  findOpenDraftRevision,
  findProductForSteward,
  listVariantsForProduct,
} from './repository';

/**
 * The read behind the REAL product editor at `/listings/[productId]`.
 *
 * `findProductForSteward` is the authorization gate - steward filter in the
 * same WHERE as the id - and it runs FIRST: a foreign or unknown product id
 * returns `null` from one statement and no child table is read. A missing
 * product and another steward's product are indistinguishable, and the page
 * renders both as the same `notFound()`.
 */

export type ProductEditorData = {
  product: ProductRow;
  /** Null when no open draft revision exists - the editor is then read-only. */
  draftRevision: ProductRevisionRow | null;
  variants: Array<{
    variant: ProductVariantRow;
    /** The provider's observed facts for this variant, when linked. */
    reference: ProviderVariantReferenceRow | null;
  }>;
  providerReference:
    (ProviderProductReferenceRow & { providerCode: string | null }) | null;
};

async function readProviderReference(productId: string) {
  const rows = await getDb()
    .select({
      reference: providerProductReferences,
      providerCode: supplierProviders.code,
    })
    .from(providerProductReferences)
    .leftJoin(
      supplierProviders,
      eq(supplierProviders.id, providerProductReferences.supplierProviderId),
    )
    .where(eq(providerProductReferences.productId, productId))
    .limit(1);

  return rows[0]
    ? { ...rows[0].reference, providerCode: rows[0].providerCode }
    : null;
}

async function readVariantReferences(
  variantIds: string[],
): Promise<Map<string, ProviderVariantReferenceRow>> {
  if (variantIds.length === 0) return new Map();

  const rows = await getDb()
    .select()
    .from(providerVariantReferences)
    .where(inArray(providerVariantReferences.variantId, variantIds));

  return new Map(rows.map((row) => [row.variantId, row]));
}

export default async function resolveProductEditorData(
  sellerAccountId: string,
  productId: string,
): Promise<ProductEditorData | null> {
  const db = getDb();
  const product = await findProductForSteward(db, productId, sellerAccountId);

  if (product === null) return null;

  const [draftRevision, variants, providerReference] = await Promise.all([
    findOpenDraftRevision(db, product.id),
    listVariantsForProduct(db, product.id),
    readProviderReference(product.id),
  ]);
  const referenceByVariant = await readVariantReferences(
    variants.map((variant) => variant.id),
  );

  return {
    product,
    draftRevision,
    variants: variants.map((variant) => ({
      variant,
      reference: referenceByVariant.get(variant.id) ?? null,
    })),
    providerReference,
  };
}
