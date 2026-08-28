import getDb, { type Database } from '@/lib/db/client';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

import { PRODUCT_AUDIT_ACTIONS, type SaveProductDraftInput } from './contracts';
import { descriptionImagesAreStored } from './description-image-storage';
import { checksumOfDescriptionDocument } from './description-document';
import openDraftForEdit from './open-draft-for-edit';
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
 * That fork is `openDraftForEdit`, which runs first and inside the same
 * transaction. It is the only place the rule lives — the description-only save
 * calls the same helper — and it hands back the revision this save must
 * actually write to, which is a different row from the one the editor sent
 * whenever the product was already published. `revisionId` travels back in the
 * result for the same reason: the editor holds a revision id, not only a
 * version, and a screen still pointing at the settled revision would be
 * refused on its very next save.
 *
 * A rejected stale write is audited. Spec §19 requires draft saves *and*
 * version conflicts to be observable, and an unrecorded rejection is exactly
 * the silent outcome ADR-010 §1 rules out.
 */

export type SaveProductDraftOutcome =
  | {
      ok: true;
      /** The draft actually written: a new one when this save forked. */
      revisionId: string;
      revisionVersion: number;
      contentChecksum: string;
      forked: boolean;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'version_conflict'
        | 'revision_in_review'
        | 'image_not_stored'
        | 'price_persistence_failed';
    };

class PricePersistenceError extends Error {
  constructor(readonly missedVariantIds: string[]) {
    super('Seller retail prices did not persist for submitted variants.');
  }
}

export default async function saveProductDraft(input: {
  request: SaveProductDraftInput;
  sellerAccountId: string;
  actorId: string;
  database?: Database;
}): Promise<SaveProductDraftOutcome> {
  const database = input.database ?? getDb();
  const { request } = input;

  // Before anything is written: every description image must live in this
  // deployment's own R2 bucket. The document schema checks the URL's shape,
  // not its host, so this is the only place a foreign address is refused —
  // see `description-image-storage.ts` for why the host check is a
  // write-boundary rule rather than part of the stored shape.
  if (!descriptionImagesAreStored(request.descriptionDocument)) {
    return { ok: false, reason: 'image_not_stored' };
  }

  const contentChecksum = checksumOfDescriptionDocument(
    request.descriptionDocument,
  );

  try {
    return await database.transaction(async (tx) => {
      const product = await findProductForSteward(
        tx,
        request.productId,
        input.sellerAccountId,
      );

      if (product === null) return { ok: false as const, reason: 'not_found' };

      const draft = await openDraftForEdit(tx, {
        product,
        revisionId: request.revisionId,
        expectedRevisionVersion: request.expectedRevisionVersion,
        actorId: input.actorId,
      });

      if (!draft.ok) {
        await appendAuditEvent(tx, {
          actorId: input.actorId,
          action: PRODUCT_AUDIT_ACTIONS.revisionSaveRejected,
          entityType: 'ProductRevision',
          entityId: request.revisionId,
          payload: {
            productId: request.productId,
            expectedVersion: request.expectedRevisionVersion,
            outcome:
              draft.reason === 'revision_in_review'
                ? 'REVISION_UNDER_REVIEW'
                : 'STALE_OR_NOT_EDITABLE',
          },
        });

        return { ok: false as const, reason: draft.reason };
      }

      const revision = await saveDraftRevisionContent(tx, {
        revisionId: draft.revisionId,
        productId: request.productId,
        expectedVersion: draft.expectedVersion,
        contentDocument: request.descriptionDocument,
        contentChecksum,
        actorId: input.actorId,
      });

      if (revision === null) {
        await appendAuditEvent(tx, {
          actorId: input.actorId,
          action: PRODUCT_AUDIT_ACTIONS.revisionSaveRejected,
          entityType: 'ProductRevision',
          entityId: draft.revisionId,
          payload: {
            productId: request.productId,
            expectedVersion: draft.expectedVersion,
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
        sals3CategoryL1: request.sals3CategoryL1,
        stewardSellerAccountId: input.sellerAccountId,
        title: request.title,
        actorId: input.actorId,
      });
      const priceWrite = await updateSellerRetailPrices(tx, {
        productId: request.productId,
        sellerAccountId: input.sellerAccountId,
        prices: request.variantRetailPrices,
        actorId: input.actorId,
      });

      if (priceWrite.missedVariantIds.length > 0) {
        throw new PricePersistenceError(priceWrite.missedVariantIds);
      }

      /*
        One event per price that actually moved, inside the same transaction as
        the write — an audit that can be committed without the change it
        describes, or the other way round, is not an audit.

        `reason` is what the editor collected when the seller unlocked the
        field. It is optional on the wire because older clients and the bulk
        `Set retail price` path do not collect one, and refusing the save would
        turn a missing note into a lost edit; the event records its absence
        rather than inventing a justification.
      */
      await priceWrite.changes.reduce(async (previous, change) => {
        await previous;

        return appendAuditEvent(tx, {
          actorId: input.actorId,
          action: PRODUCT_AUDIT_ACTIONS.retailPriceOverridden,
          entityType: 'ProductOffer',
          entityId: change.offerId,
          payload: {
            productId: request.productId,
            variantId: change.variantId,
            previousAmountMinor: change.previousAmountMinor,
            previousCurrency: change.previousCurrency,
            /** `SELLER_RETAIL_PRICE_V1` means this was already an override. */
            previousResolverVersion: change.previousResolverVersion,
            amountMinor: change.amountMinor,
            currency: change.currency,
            reason: request.retailPriceOverrideReason ?? null,
          },
        });
      }, Promise.resolve());

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: PRODUCT_AUDIT_ACTIONS.revisionSaved,
        entityType: 'ProductRevision',
        entityId: revision.id,
        payload: {
          productId: request.productId,
          previousVersion: draft.expectedVersion,
          version: revision.version,
          contentChecksum,
          /** Set only when this save forked; see `save-description-document.ts`. */
          forkedFromRevisionId: draft.forked ? request.revisionId : undefined,
          blockCount: request.descriptionDocument.blocks.length,
          sals3CategoryL1: request.sals3CategoryL1,
          pricedOfferCount: priceWrite.updatedOfferCount,
        },
      });

      return {
        ok: true as const,
        revisionId: revision.id,
        revisionVersion: revision.version,
        contentChecksum,
        forked: draft.forked,
      };
    });
  } catch (error) {
    if (error instanceof PricePersistenceError) {
      return { ok: false, reason: 'price_persistence_failed' };
    }

    throw error;
  }
}
