import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { products } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { findProductForSteward } from './repository';

/**
 * Persists whether the supplier's own photo shows to buyers alongside a
 * seller upload. A plain compare-and-set column on `products`, same
 * reasoning as `save-meta-description.ts`: this is an editorial toggle, not
 * revisioned content, so it carries no draft/frozen lifecycle of its own.
 */
export type SaveShowSupplierPhotoResult =
  | { ok: true; productVersion: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'version_conflict' };

export default async function saveShowSupplierPhoto(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  showSupplierPhoto: boolean;
  db?: Database;
}): Promise<SaveShowSupplierPhotoResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx): Promise<SaveShowSupplierPhotoResult> => {
    const product = await findProductForSteward(
      tx,
      input.productId,
      input.sellerAccountId,
    );

    if (product === null) return { ok: false, reason: 'not_found' };
    if (product.version !== input.expectedProductVersion) {
      return { ok: false, reason: 'version_conflict' };
    }

    const [updated] = await tx
      .update(products)
      .set({
        showSupplierPhoto: input.showSupplierPhoto,
        version: input.expectedProductVersion + 1,
        updatedAt: now,
        updatedBy: input.actorId,
      })
      .where(
        and(
          eq(products.id, input.productId),
          // Re-asserted at the write: a concurrent edit between the read
          // above and here must lose rather than be silently overwritten.
          eq(products.version, input.expectedProductVersion),
        ),
      )
      .returning({ version: products.version });

    if (updated === undefined) return { ok: false, reason: 'version_conflict' };

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.showSupplierPhotoSaved,
      entityType: 'product',
      entityId: input.productId,
      payload: {
        sellerAccountId: input.sellerAccountId,
        showSupplierPhoto: input.showSupplierPhoto,
      },
    });

    return { ok: true, productVersion: updated.version };
  });
}
