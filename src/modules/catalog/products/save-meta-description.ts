import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { products } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { findProductForSteward } from './repository';

/**
 * Persists the seller-edited page meta description (SEO/AEO/GEO discovery
 * copy — owner-scoped narrowly to this one field, not a full SEO control
 * center). Distinct from the buyer-visible PDP body, which lives on
 * `product_revisions` and has its own draft/frozen lifecycle; a meta
 * description carries no such lifecycle, so it is a plain compare-and-set
 * column on `products` rather than a revisioned document.
 *
 * `null` clears it back to "not set" rather than storing an empty string —
 * the schema comment on `products.metaDescription` makes the same
 * distinction, and a future PDP render should be able to tell "the seller
 * decided against one" apart from "nobody has looked at this yet" the same
 * way, even though neither is implemented behind this field today.
 */
export type SaveMetaDescriptionResult =
  | { ok: true; productVersion: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'version_conflict' };

export default async function saveMetaDescription(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  metaDescription: string | null;
  db?: Database;
}): Promise<SaveMetaDescriptionResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx): Promise<SaveMetaDescriptionResult> => {
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
        metaDescription: input.metaDescription,
        version: input.expectedProductVersion + 1,
        updatedAt: now,
        updatedBy: input.actorId,
      })
      .where(
        and(
          eq(products.id, input.productId),
          // Re-asserted at the write, same reasoning every other
          // compare-and-set product mutation in this module gives: a
          // concurrent edit between the read above and here must lose
          // rather than be silently overwritten.
          eq(products.version, input.expectedProductVersion),
        ),
      )
      .returning({ version: products.version });

    if (updated === undefined) return { ok: false, reason: 'version_conflict' };

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.metaDescriptionSaved,
      entityType: 'product',
      entityId: input.productId,
      payload: {
        sellerAccountId: input.sellerAccountId,
        length: input.metaDescription?.length ?? 0,
      },
    });

    return { ok: true, productVersion: updated.version };
  });
}
