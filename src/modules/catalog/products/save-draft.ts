import getDb, { type Database } from '@/lib/db/client';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

import { PRODUCT_AUDIT_ACTIONS, type SaveProductDraftInput } from './contracts';
import { checksumOfDescriptionDocument } from './description-document';
import {
  findProductForSteward,
  saveDraftRevisionContent,
  updateSellerRetailPrices,
  updateProductEditorialForSteward,
} from './repository';

/**
 * Saves editorial content onto an open draft revision.
 *
 * Two protections, in this order, both server-side:
 *
 * 1. **Stewardship.** `findProductForSteward` returns nothing for a product
 *    this seller account does not own the editorial record for, so a
 *    cross-tenant `productId` is indistinguishable from one that never
 *    existed.
 * 2. **Optimistic concurrency.** The update names the revision version the
 *    editor rendered *and* `workflow_state = 'DRAFT'`. A stale tab loses the
 *    race, and a submitted or approved revision cannot be rewritten in place
 *    at all — spec §16's immutability rule enforced in the `WHERE` clause
 *    rather than by convention. Editing a settled revision is a fork into a
 *    new draft, never an in-place overwrite of what a reviewer approved or an
 *    accepted order referenced (ADR-007 invariant 3).
 *
 * A rejected stale write is audited. Spec §19 requires draft saves *and*
 * version conflicts to be observable, and an unrecorded rejection is exactly
 * the silent outcome ADR-010 §1 rules out.
 */

export type SaveProductDraftOutcome =
  | { ok: true; revisionVersion: number; contentChecksum: string }
  | { ok: false; reason: 'not_found' | 'version_conflict' };

export default async function saveProductDraft(input: {
  request: SaveProductDraftInput;
  sellerAccountId: string;
  actorId: string;
  database?: Database;
}): Promise<SaveProductDraftOutcome> {
  const database = input.database ?? getDb();
  const { request } = input;
  const contentChecksum = checksumOfDescriptionDocument(
    request.descriptionDocument,
  );

  return database.transaction(async (tx) => {
    const product = await findProductForSteward(
      tx,
      request.productId,
      input.sellerAccountId,
    );

    if (product === null) return { ok: false as const, reason: 'not_found' };

    const revision = await saveDraftRevisionContent(tx, {
      revisionId: request.revisionId,
      productId: request.productId,
      expectedVersion: request.expectedRevisionVersion,
      contentDocument: request.descriptionDocument,
      contentChecksum,
      actorId: input.actorId,
    });

    if (revision === null) {
      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: PRODUCT_AUDIT_ACTIONS.revisionSaveRejected,
        entityType: 'ProductRevision',
        entityId: request.revisionId,
        payload: {
          productId: request.productId,
          expectedVersion: request.expectedRevisionVersion,
          // Which of "wrong version", "not a draft any more", or "not this
          // product's revision" failed is deliberately not distinguished for
          // the caller; the audit records what was attempted.
          outcome: 'STALE_OR_NOT_EDITABLE',
        },
      });

      return { ok: false as const, reason: 'version_conflict' };
    }

    await updateProductEditorialForSteward(tx, {
      productId: request.productId,
      stewardSellerAccountId: input.sellerAccountId,
      title: request.title,
      sals3CategoryL1: request.sals3CategoryL1,
      actorId: input.actorId,
    });
    const pricedOfferCount = await updateSellerRetailPrices(tx, {
      productId: request.productId,
      sellerAccountId: input.sellerAccountId,
      prices: request.variantRetailPrices,
      actorId: input.actorId,
    });

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.revisionSaved,
      entityType: 'ProductRevision',
      entityId: revision.id,
      payload: {
        productId: request.productId,
        previousVersion: request.expectedRevisionVersion,
        version: revision.version,
        contentChecksum,
        blockCount: request.descriptionDocument.blocks.length,
        sals3CategoryL1: request.sals3CategoryL1,
        pricedOfferCount,
      },
    });

    return {
      ok: true as const,
      revisionVersion: revision.version,
      contentChecksum,
    };
  });
}
