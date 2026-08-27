import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productMediaSources } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { findProductForSteward } from './repository';

/**
 * The seller's arrangement of one product's gallery — and, by the same write,
 * which photo is the cover.
 *
 * ## The cover is position 0
 *
 * There is no `is_cover` column and there should not be one. "Which order do
 * these appear in" and "which one leads" are the same question asked twice, and
 * two columns holding one answer is two columns that can disagree — invisibly,
 * until a buyer is served a lead photo the seller did not pick. Every marketplace
 * editor a Sals3 seller already uses works this way: the first tile carries the
 * `Cover` badge, and making something the cover means moving it to the front.
 *
 * ## Why a supplier's photo may be moved (ADR-011 amendment, 2026-08-28)
 *
 * ADR-011 §3 called the supplier set *"read-only"* and the editor honoured that
 * literally: never reorderable, never a cover choice. The owner amended it. The
 * distinction that makes this safe is one this codebase already draws —
 * `assign-variant-media.ts` moves `variant_id` onto a `SUPPLIER_ORIGINAL` row and
 * argues that *saying which variant a photo depicts is a Sals3 editorial fact
 * about supplier evidence rather than a change to the evidence*. Display order is
 * the same kind of fact. A supplier row was always assignable to a variant while
 * being unmovable in the gallery, which was an inconsistency rather than a rule.
 *
 * So this writes `position` and nothing else. `source_url`, `stored_url`,
 * `checksum`, `observed_at`, `rights_basis`, `review_state`, and every observed
 * dimension are untouched, and Supplier Details' read-only evidence gallery —
 * the panel ADR-011 §3 actually exists to guarantee — still shows the supplier's
 * own set, in the supplier's own order, unaffected by any of this.
 *
 * ## Deleting is still not possible here, and still not possible for a supplier row
 *
 * This function only ever issues `UPDATE ... SET position`. It cannot remove a
 * row, and `delete-seller-media.ts` keeps its `sourceType = 'SELLER_UPLOAD'`
 * condition, so the amendment widens what a seller may *arrange* without widening
 * what they may destroy.
 *
 * ## Ownership is checked the same way twice
 *
 * The product is resolved through `findProductForSteward`, so a crafted
 * `productId` belonging to another seller is `not_found` before anything is read.
 * Then the media rows are matched on that product's own id inside the same
 * predicate, so an id from a *different* product of the *same* seller cannot be
 * repositioned either — the case a tenant check alone would let through.
 *
 * ## The whole gallery, or nothing
 *
 * `mediaIds` must name every arrangeable row of the product exactly once. A
 * partial list is refused rather than applied, because positions are only
 * meaningful relative to each other: writing three of eight would interleave the
 * arranged rows with rows still ordered by observation time, and the result would
 * be an order the seller never saw. The client sends what it rendered, and a list
 * that no longer matches the database means the two have diverged — a photo
 * deleted or uploaded in another tab — which is a reload, not a write.
 */

export type ReorderProductMediaRefusal =
  'not_found' | 'INCOMPLETE_ORDER' | 'DUPLICATE_MEDIA_ID';

export type ReorderProductMediaResult =
  | { ok: true; positioned: number }
  | { ok: false; reason: ReorderProductMediaRefusal };

export default async function reorderProductMedia(input: {
  productId: string;
  /** Every arrangeable media row of this product, in the order the seller wants. */
  mediaIds: string[];
  sellerAccountId: string;
  actorId: string;
  db?: Database;
}): Promise<ReorderProductMediaResult> {
  const db = input.db ?? getDb();

  if (new Set(input.mediaIds).size !== input.mediaIds.length) {
    return { ok: false, reason: 'DUPLICATE_MEDIA_ID' };
  }

  return db.transaction(async (tx): Promise<ReorderProductMediaResult> => {
    const product = await findProductForSteward(
      tx,
      input.productId,
      input.sellerAccountId,
    );

    if (product === null) return { ok: false, reason: 'not_found' };

    /**
     * The gallery is product-level rows only, matching what the storefront
     * serves (`storefront/read-model.ts`'s `loadApprovedImages`) and what the
     * editor renders. A variation photo has no place in this ordering: the buyer
     * is served exactly one of those, chosen by the option they picked, so it has
     * no neighbours to be ordered against.
     */
    const rows = await tx
      .select({ id: productMediaSources.id })
      .from(productMediaSources)
      .where(
        and(
          eq(productMediaSources.productId, product.id),
          isNull(productMediaSources.variantId),
        ),
      );

    const known = new Set(rows.map((row) => row.id));
    const namesEveryRow =
      input.mediaIds.length === known.size &&
      input.mediaIds.every((mediaId) => known.has(mediaId));

    if (!namesEveryRow) return { ok: false, reason: 'INCOMPLETE_ORDER' };

    // Sequential on purpose: one `UPDATE` per row inside one transaction. A
    // single `CASE` statement would be one round trip, but this runs on a
    // gallery bounded at a couple of dozen rows and correctness reads better
    // than a hand-built `CASE` over caller-supplied ids.
    // eslint-disable-next-line no-restricted-syntax -- see above; atomicity comes from the transaction, not the loop.
    for (const [position, mediaId] of input.mediaIds.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await tx
        .update(productMediaSources)
        .set({ position })
        .where(
          and(
            eq(productMediaSources.id, mediaId),
            eq(productMediaSources.productId, product.id),
            inArray(productMediaSources.id, input.mediaIds),
          ),
        );
    }

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.mediaReordered,
      entityType: 'Product',
      entityId: product.id,
      payload: {
        productId: product.id,
        sellerAccountId: input.sellerAccountId,
        // The resulting order, so the trail answers "what did it become",
        // which is the question anyone reading it actually has.
        mediaIds: input.mediaIds,
        coverMediaId: input.mediaIds[0] ?? null,
      },
    });

    return { ok: true, positioned: input.mediaIds.length };
  });
}
