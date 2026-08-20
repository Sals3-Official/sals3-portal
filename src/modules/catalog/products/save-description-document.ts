import getDb, { type Database } from '@/lib/db/client';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import type { DescriptionDocument } from './description-document';
import { checksumOfDescriptionDocument } from './description-document';
import { descriptionImagesAreStored } from './description-image-storage';
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
 */
export type SaveDescriptionDocumentResult =
  | { ok: true; revisionVersion: number; contentChecksum: string }
  | {
      ok: false;
      reason: 'not_found' | 'version_conflict' | 'image_not_stored';
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

      const revision = await saveDraftRevisionContent(tx, {
        revisionId: input.revisionId,
        productId: input.productId,
        expectedVersion: input.expectedRevisionVersion,
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
          entityId: input.revisionId,
          payload: {
            productId: input.productId,
            expectedVersion: input.expectedRevisionVersion,
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
          previousVersion: input.expectedRevisionVersion,
          version: revision.version,
          contentChecksum,
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
        revisionVersion: revision.version,
        contentChecksum,
      };
    },
  );
}
