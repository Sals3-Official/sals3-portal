import 'server-only';

import { del } from '@vercel/blob';
import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productMediaSources } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { findProductForSteward } from './repository';

export type DeleteSellerMediaResult =
  { ok: true } | { ok: false; reason: 'NOT_FOUND' };

/**
 * Removes one of a seller's own uploaded product photos.
 *
 * The `sourceType: 'SELLER_UPLOAD'` condition is load-bearing, not
 * defensive padding: it is inside the same `DELETE ... WHERE` as the
 * ownership and id checks, so a request naming a `SUPPLIER_ORIGINAL` row -
 * whether by mistake or by a crafted id - deletes nothing and reports the
 * identical `NOT_FOUND` a genuinely unknown id would. A supplier's photo is
 * read-only evidence; this function is structurally incapable of touching
 * one.
 *
 * The database row is the source of truth and is removed first. Deleting
 * the underlying Blob object is best-effort after that: if it fails, the
 * object becomes an orphan costing storage, which is a smaller problem than
 * leaving a photo the seller asked to remove still visible somewhere.
 */
export async function deleteSellerProductMedia(input: {
  productId: string;
  mediaId: string;
  sellerAccountId: string;
  actorId: string;
  db?: Database;
}): Promise<DeleteSellerMediaResult> {
  const db = input.db ?? getDb();

  const product = await findProductForSteward(
    db,
    input.productId,
    input.sellerAccountId,
  );

  if (product === null) return { ok: false, reason: 'NOT_FOUND' };

  const [deleted] = await db
    .delete(productMediaSources)
    .where(
      and(
        eq(productMediaSources.id, input.mediaId),
        eq(productMediaSources.productId, product.id),
        eq(productMediaSources.sourceType, 'SELLER_UPLOAD'),
      ),
    )
    .returning({
      sourceUrl: productMediaSources.sourceUrl,
      checksum: productMediaSources.checksum,
    });

  if (deleted === undefined) return { ok: false, reason: 'NOT_FOUND' };

  if (deleted.sourceUrl !== null) {
    try {
      await del(deleted.sourceUrl);
    } catch {
      // Logged through the audit event below rather than a console call -
      // an orphaned Blob object is a storage cost to clean up later, not a
      // reason to tell the seller their delete failed when it did not.
    }
  }

  await appendAuditEvent(db, {
    actorId: input.actorId,
    action: PRODUCT_AUDIT_ACTIONS.mediaDeleted,
    entityType: 'ProductMediaSource',
    entityId: input.mediaId,
    payload: {
      productId: product.id,
      sellerAccountId: input.sellerAccountId,
      checksum: deleted.checksum,
    },
  });

  return { ok: true };
}
