import getDb from '@/lib/db/client';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { archiveProductForSteward, findProductForSteward } from './repository';

/**
 * Archiving one Sals3 product.
 *
 * Archiving stops new sales and nothing else. It never deletes the product, its
 * revisions, the supplier evidence, or the audit trail, and it never touches an
 * already-accepted order - which is why it is the safe lifecycle action and why
 * there is no Delete anywhere in this UI (ADR-007).
 *
 * The outcome is a named union rather than a boolean. A caller doing this in
 * bulk has to tell "already archived" (fine, say so) from "someone else edited
 * this row first" (retry) from "not yours" (do not admit it exists), and a
 * boolean forces all three into one misleading message.
 */

export type ArchiveOutcome =
  | { kind: 'archived'; productId: string; title: string }
  /** Idempotent replay: a second Archive on an archived row is not an error. */
  | { kind: 'already-archived'; productId: string; title: string }
  /** The row changed under the caller - the table it was clicked from is stale. */
  | { kind: 'stale'; productId: string }
  /** Published rows are out of scope until the publish flow exists. */
  | { kind: 'published'; productId: string; title: string }
  /** Missing, or another tenant's. The two are indistinguishable on purpose. */
  | { kind: 'not-found'; productId: string };

export default async function archiveProduct(input: {
  sellerAccountId: string;
  productId: string;
  actorId: string;
}): Promise<ArchiveOutcome> {
  const db = getDb();

  return db.transaction(async (tx) => {
    // The gate and the read in one statement: a foreign product is
    // indistinguishable from a missing one from here on.
    const product = await findProductForSteward(
      tx,
      input.productId,
      input.sellerAccountId,
    );

    if (product === null)
      return { kind: 'not-found', productId: input.productId };

    if (product.publicationState === 'ARCHIVED')
      return {
        kind: 'already-archived',
        productId: product.id,
        title: product.title,
      };

    if (product.publicationState === 'PUBLISHED')
      return { kind: 'published', productId: product.id, title: product.title };

    const archived = await archiveProductForSteward(tx, {
      productId: product.id,
      stewardSellerAccountId: input.sellerAccountId,
      expectedVersion: product.version,
      actorId: input.actorId,
    });

    if (archived === null) {
      // Recorded, not swallowed: a lost race is the one failure mode a seller
      // will report as "I clicked Archive and nothing happened".
      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: PRODUCT_AUDIT_ACTIONS.productArchiveRejected,
        entityType: 'Product',
        entityId: product.id,
        payload: {
          sellerAccountId: input.sellerAccountId,
          expectedVersion: product.version,
          observedState: product.publicationState,
        },
      });

      return { kind: 'stale', productId: product.id };
    }

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.productArchived,
      entityType: 'Product',
      entityId: archived.id,
      payload: {
        sellerAccountId: input.sellerAccountId,
        fromState: product.publicationState,
        toState: archived.publicationState,
        version: archived.version,
      },
    });

    return { kind: 'archived', productId: archived.id, title: archived.title };
  });
}
