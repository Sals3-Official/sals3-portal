import getDb, { type Database } from '@/lib/db/client';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import type { DescriptionDocument } from './description-document';
import { checksumOfDescriptionDocument } from './description-document';
import { descriptionImagesAreStored } from './description-image-storage';
import openDraftForEdit from './open-draft-for-edit';
import { findProductForSteward, saveDraftRevisionContent } from './repository';

/**
 * Saves the description document alone, without touching title, category, or
 * prices.
 *
 * `saveProductDraft` already writes this document, but it writes it as one
 * field of a whole-draft payload: it requires a title and a category and it
 * rewrites every variant's retail price. The description editor is a separate
 * screen with none of those values in hand, and sending stale copies of them
 * back would let a description save quietly revert a price somebody changed in
 * another tab. So this is a narrower mutation over the same row, following the
 * shape `saveMetaDescription`, `saveShowSupplierPhoto`, and
 * `renameOptionMapping` already established for a single-concern edit.
 *
 * The two protections are unchanged and in the same order as the full draft
 * save: stewardship first, so a product this seller does not own the editorial
 * record for is indistinguishable from one that never existed, then optimistic
 * concurrency on the exact revision version the editor rendered *and*
 * `workflow_state = 'DRAFT'`. A submitted or approved revision cannot be
 * rewritten in place at all — editing a settled revision is a fork into a new
 * draft, never an overwrite of what a reviewer approved or an accepted order
 * referenced (ADR-007 invariant 3).
 *
 * That fork is `openDraftForEdit`, and it runs inside this transaction rather
 * than in a step of its own: a draft created for an edit that then fails
 * validation would be an open draft nobody asked for, and it would block the
 * next fork through the open-draft index. Both outcomes roll back together.
 *
 * `revisionId` in the result is not decoration. The fork answers on a
 * *different* row from the one the editor sent, and the editor holds its
 * revision id as well as its version — so the id has to travel back or the
 * next save from that screen names the settled revision again and is refused.
 */
export type SaveDescriptionDocumentResult =
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
        | 'image_not_stored';
    };

export default async function saveDescriptionDocument(input: {
  productId: string;
  revisionId: string;
  expectedRevisionVersion: number;
  descriptionDocument: DescriptionDocument;
  sellerAccountId: string;
  actorId: string;
  database?: Database;
}): Promise<SaveDescriptionDocumentResult> {
  const database = input.database ?? getDb();

  // Every description image must live in this deployment's own R2 bucket. The
  // document schema checks a URL's shape, never its host — see
  // `description-image-storage.ts` for why the host check belongs at the write
  // boundary — so this is the only place a foreign address is refused. It runs
  // before the transaction opens because it needs no database read.
  if (!descriptionImagesAreStored(input.descriptionDocument)) {
    return { ok: false, reason: 'image_not_stored' };
  }

  const contentChecksum = checksumOfDescriptionDocument(
    input.descriptionDocument,
  );

  return database.transaction(
    async (tx): Promise<SaveDescriptionDocumentResult> => {
      const product = await findProductForSteward(
        tx,
        input.productId,
        input.sellerAccountId,
      );

      if (product === null) return { ok: false, reason: 'not_found' };

      const draft = await openDraftForEdit(tx, {
        product,
        revisionId: input.revisionId,
        expectedRevisionVersion: input.expectedRevisionVersion,
        actorId: input.actorId,
      });

      if (!draft.ok) {
        await appendAuditEvent(tx, {
          actorId: input.actorId,
          action: PRODUCT_AUDIT_ACTIONS.revisionSaveRejected,
          entityType: 'ProductRevision',
          entityId: input.revisionId,
          payload: {
            productId: input.productId,
            expectedVersion: input.expectedRevisionVersion,
            scope: 'DESCRIPTION_ONLY',
            outcome:
              draft.reason === 'revision_in_review'
                ? 'REVISION_UNDER_REVIEW'
                : 'STALE_OR_NOT_EDITABLE',
          },
        });

        return { ok: false, reason: draft.reason };
      }

      const revision = await saveDraftRevisionContent(tx, {
        revisionId: draft.revisionId,
        productId: input.productId,
        expectedVersion: draft.expectedVersion,
        contentDocument: input.descriptionDocument,
        contentChecksum,
        actorId: input.actorId,
      });

      if (revision === null) {
        // A rejected stale write is audited: spec §19 requires draft saves and
        // version conflicts both to be observable, and an unrecorded rejection
        // is the silent outcome ADR-010 §1 rules out.
        await appendAuditEvent(tx, {
          actorId: input.actorId,
          action: PRODUCT_AUDIT_ACTIONS.revisionSaveRejected,
          entityType: 'ProductRevision',
          entityId: draft.revisionId,
          payload: {
            productId: input.productId,
            expectedVersion: draft.expectedVersion,
            scope: 'DESCRIPTION_ONLY',
            outcome: 'STALE_OR_NOT_EDITABLE',
          },
        });

        return { ok: false, reason: 'version_conflict' };
      }

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: PRODUCT_AUDIT_ACTIONS.revisionSaved,
        entityType: 'ProductRevision',
        entityId: revision.id,
        payload: {
          productId: input.productId,
          previousVersion: draft.expectedVersion,
          version: revision.version,
          contentChecksum,
          /**
           * Names the draft this landed on when it was not the one the editor
           * sent, so `revisionForked` and the save that followed it read as
           * one action in the trail.
           */
          forkedFromRevisionId: draft.forked ? input.revisionId : undefined,
          blockCount: input.descriptionDocument.blocks.length,
          /**
           * Names what this save covered, so the trail distinguishes it from a
           * whole-draft save that happens to carry the same checksum. Without
           * it a reviewer reading the history cannot tell whether the title and
           * prices were also rewritten at this version.
           */
          scope: 'DESCRIPTION_ONLY',
          emphasisedParagraphCount: input.descriptionDocument.blocks.filter(
            (block) => block.type === 'paragraph' && block.runs !== undefined,
          ).length,
        },
      });

      return {
        ok: true,
        revisionId: revision.id,
        revisionVersion: revision.version,
        contentChecksum,
        forked: draft.forked,
      };
    },
  );
}
