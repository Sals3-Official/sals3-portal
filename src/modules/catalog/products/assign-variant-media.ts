import 'server-only';

import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productMediaSources, productVariants } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { findProductForSteward } from './repository';

/**
 * Pointing one stored photo at one variant — the write side of a column that
 * has existed, unwritten, since the table was created.
 *
 * `product_media_sources.variant_id` is documented as "set when the media
 * depicts one specific variant (ADR-013 §8)" and the editor's read model has
 * always reported `hasImage` from it. Nothing ever set it: every variant of
 * every product in production reported no image, and the Variant Matrix showed
 * a placeholder no seller could replace, on rows whose photos were already
 * uploaded and already stored.
 *
 * ## What this may and may not do
 *
 * It moves a pointer. No file is uploaded, copied, re-encoded, or deleted, and
 * no supplier-owned row is edited in any other respect — a `SUPPLIER_ORIGINAL`
 * photo is as assignable as the seller's own, because saying *which variant a
 * photo depicts* is a Sals3 editorial fact about supplier evidence rather than a
 * change to the evidence. `source_url`, `checksum`, `rights_basis`,
 * `review_state`, and every observed dimension stay exactly as recorded.
 *
 * ## Ownership is checked twice, for two different reasons
 *
 * The product is resolved through `findProductForSteward`, so a crafted
 * `productId` belonging to another seller is `NOT_FOUND` before anything is
 * read. Then both the media row and the variant row are matched on that
 * product's own id inside the same predicate, so a media id or variant id from
 * a *different* product of the *same* seller cannot be joined either — which is
 * the case a tenant check alone would let through, and the one that would
 * silently show buyers a photo of another product.
 *
 * ## Clearing is the same write
 *
 * `variantId: null` returns the row to product level, which is what the cover
 * projection reads. Unassigning is therefore not a delete and costs the seller
 * nothing: the photo stays in the product's media, and its row keeps its
 * identity, its checksum, and its place in the gallery.
 */

export type AssignVariantMediaRefusal =
  'not_found' | 'MEDIA_NOT_FOUND' | 'VARIANT_NOT_FOUND';

export type AssignVariantMediaResult =
  | { ok: true; mediaId: string; variantId: string | null }
  | { ok: false; reason: AssignVariantMediaRefusal };

export default async function assignVariantMedia(input: {
  productId: string;
  /** The `product_media_sources` row to point. */
  mediaId: string;
  /** The variant it depicts, or `null` to return it to product level. */
  variantId: string | null;
  sellerAccountId: string;
  actorId: string;
  db?: Database;
}): Promise<AssignVariantMediaResult> {
  const db = input.db ?? getDb();

  return db.transaction(async (tx): Promise<AssignVariantMediaResult> => {
    const product = await findProductForSteward(
      tx,
      input.productId,
      input.sellerAccountId,
    );

    if (product === null) return { ok: false, reason: 'not_found' };

    if (input.variantId !== null) {
      // Matched on this product's id, not merely on the variant's own: a
      // variant of another product would otherwise pass a tenant check and put
      // this photo on goods it does not depict.
      const variantRows = await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.id, input.variantId),
            eq(productVariants.productId, product.id),
          ),
        )
        .limit(1);

      if (variantRows[0] === undefined) {
        return { ok: false, reason: 'VARIANT_NOT_FOUND' };
      }
    }

    /**
     * Read before write, so the audit trail can record the move.
     *
     * `UPDATE ... RETURNING` in Postgres reports the row as it is *after* the
     * statement, so it cannot supply the previous holder — an earlier draft of
     * this function read `returning({ previousVariantId })` and would have
     * recorded the destination twice while claiming one of them was the origin.
     */
    const existingRows = await tx
      .select({
        id: productMediaSources.id,
        variantId: productMediaSources.variantId,
        sourceType: productMediaSources.sourceType,
      })
      .from(productMediaSources)
      .where(
        and(
          eq(productMediaSources.id, input.mediaId),
          eq(productMediaSources.productId, product.id),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    if (existing === undefined) {
      return { ok: false, reason: 'MEDIA_NOT_FOUND' };
    }

    await tx
      .update(productMediaSources)
      .set({ variantId: input.variantId })
      .where(eq(productMediaSources.id, existing.id));

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.variantMediaAssigned,
      entityType: 'ProductMediaSource',
      entityId: existing.id,
      payload: {
        productId: product.id,
        sellerAccountId: input.sellerAccountId,
        variantId: input.variantId,
        previousVariantId: existing.variantId,
        sourceType: existing.sourceType,
      },
    });

    return { ok: true, mediaId: existing.id, variantId: input.variantId };
  });
}
