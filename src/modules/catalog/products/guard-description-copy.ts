import { eq } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import { productVariants, providerVariantReferences } from '@/lib/db/schema';
import checkDescriptionCopy, {
  sizesOnSale,
  type CopyVerdict,
} from './description-copy-guard';
import type { DescriptionBlock } from './description-document';

/**
 * Run the copy rules against a document about to be written for a product -
 * the database half of `description-copy-guard.ts` (which stays pure): the
 * size claims in prose are checked against the sizes the product's own
 * variant labels sell.
 *
 * Enforced on the INTERNAL API's description writes only, deliberately. The
 * Description Studio keeps a person in the loop, and a person overruling a
 * style rule on their own page is an editing decision; an unattended API
 * caller has no one to overrule anything, so for it every problem is a
 * refusal. The client used to run these same rules before its HTTP call
 * (`description_guard.refuse_or_pass`) - moved server-side 2026-09-02 on
 * the owner's instruction, so a future caller that skips the client cannot
 * skip the rules.
 */
export default async function guardDescriptionCopy(
  productId: string,
  blocks: readonly DescriptionBlock[],
): Promise<CopyVerdict> {
  const db = getDb();

  const rows = await db
    .select({ label: providerVariantReferences.sourceOptionLabel })
    .from(productVariants)
    .leftJoin(
      providerVariantReferences,
      eq(providerVariantReferences.variantId, productVariants.id),
    )
    .where(eq(productVariants.productId, productId));

  return checkDescriptionCopy(
    blocks,
    sizesOnSale(rows.map((row) => row.label)),
  );
}
