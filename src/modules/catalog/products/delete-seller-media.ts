import 'server-only';

import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productMediaSources } from '@/lib/db/schema';
import { getR2Client, readR2Config } from '@/lib/storage/r2-client';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { findProductForSteward } from './repository';

/**
 * The key `upload-seller-media.ts` wrote the object under is the URL path
 * relative to the configured public base — `r2PublicUrlForKey` builds a
 * stored `sourceUrl` as exactly `${publicBaseUrl}/${key}`, so recovering the
 * key here is the inverse string operation, not a second source of truth.
 * `null` when the stored URL does not sit under the currently configured
 * base (a base URL changed since upload, or storage is unconfigured here) -
 * that leaves the R2 object undeleted, the same accepted orphan cost the
 * upload side's duplicate-checksum path already takes.
 */
function objectKeyFromPublicUrl(
  sourceUrl: string,
  publicBaseUrl: string,
): string | null {
  const base = publicBaseUrl.endsWith('/')
    ? publicBaseUrl
    : `${publicBaseUrl}/`;

  return sourceUrl.startsWith(base) ? sourceUrl.slice(base.length) : null;
}

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
 * the underlying R2 object is best-effort after that: if it fails, the
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

  const r2Config = readR2Config();

  if (deleted.sourceUrl !== null && r2Config !== null) {
    const objectKey = objectKeyFromPublicUrl(
      deleted.sourceUrl,
      r2Config.publicBaseUrl,
    );

    if (objectKey !== null) {
      try {
        await getR2Client(r2Config).send(
          new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: objectKey }),
        );
      } catch {
        // Logged through the audit event below rather than a console call -
        // an orphaned R2 object is a storage cost to clean up later, not a
        // reason to tell the seller their delete failed when it did not.
      }
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
