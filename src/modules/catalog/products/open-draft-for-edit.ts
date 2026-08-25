import type { ProductRow } from '@/lib/db/schema';
import {
  appendAuditEvent,
  type Executor,
} from '@/modules/catalog/candidates/repository';

import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import {
  checksumOfDescriptionDocument,
  descriptionDocumentSchema,
} from './description-document';
import {
  findHighestRevisionNumber,
  findOpenDraftRevision,
  findRevisionOfProduct,
  insertDraftRevision,
  setCurrentRevision,
} from './repository';

/**
 * Resolves the open `DRAFT` revision a revision-scoped write should land on,
 * forking one from the settled revision when the product is published.
 *
 * ## Why this exists at all
 *
 * `saveDraftRevisionContent` writes only where `workflow_state = 'DRAFT'`, and
 * publishing moves the revision to `APPROVED` (`publish.ts`). Nothing forked
 * the next draft afterwards, so every revision-scoped save on a published
 * product was refused as `version_conflict` while the editor still offered
 * `Save New Draft` and `Publish Update`. The fork was designed —
 * `insertDraftRevision`'s own comment describes it — and never wired.
 *
 * ## Why one helper rather than one fork per write path
 *
 * Both `save-draft.ts` and `save-description-document.ts` need it, and a third
 * revision-scoped write would need it too. Copied three times, the rule drifts
 * three times: the interesting part is not the insert, it is the refusals
 * around it, and those must be identical everywhere or the same seller action
 * gets different answers depending on which button they pressed.
 *
 * ## What it refuses, and why no refusal is a loosening
 *
 * The fix must not weaken the concurrency check — a fork is a *new* draft, not
 * permission to write to a settled row:
 *
 * - **Not this product's revision, or gone.** `version_conflict`. The caller
 *   already proved stewardship of the product; the revision id is still
 *   checked against it rather than trusted.
 * - **Already a `DRAFT`.** Returned untouched, with the caller's own expected
 *   version. Nothing is forked and nothing is relaxed — the existing
 *   compare-and-set in `saveDraftRevisionContent` still decides, so a stale
 *   tab loses exactly as it does today. A version mismatch must never become
 *   a reason to fork.
 * - **`IN_REVIEW` / `CHANGES_REQUESTED`.** `revision_in_review`. Forking from
 *   the last `APPROVED` revision instead would be worse than a refusal:
 *   `publish.ts` selects only from `['DRAFT', 'APPROVED']`, so publishing that
 *   fork would step straight past the revision under review with no error and
 *   no notice, and the database cannot stop it — the open-draft index covers
 *   `DRAFT` only, so a `DRAFT` and an `IN_REVIEW` revision coexist happily.
 *   No code writes either state today, so this path is unreachable in
 *   production and is held by `open-draft-for-edit.test.ts` instead.
 * - **A settled revision that is not the current one.** `version_conflict`.
 *   The version token alone does not catch this: a tab that loaded before
 *   someone else published still holds a matching version for a revision that
 *   has since been superseded, and forking from it would resurrect older copy
 *   over newer published copy at the next publish.
 * - **Another writer got there first.** `version_conflict`. The partial unique
 *   index `product_revisions_open_draft_key` decides, and the loser is refused
 *   rather than quietly redirected into the winner's draft — two tabs must not
 *   end up writing one draft each believing it holds its own.
 *
 * ## What the fork starts from
 *
 * `content_snapshot`, never `content_document`. `publish.ts` copies the
 * document into the snapshot verbatim at freeze, and both writers of
 * `content_document` are gated on `DRAFT`, so on a settled row the two agree
 * today — the snapshot is chosen because it is the copy that was published,
 * not because they differ. A settled row with no snapshot violates the
 * `product_revisions_frozen_when_settled` check constraint, so it cannot exist
 * unless the database has been damaged: that raises here, rather than being
 * papered over with an empty document the seller would silently publish.
 *
 * The new draft carries `content_snapshot: null` and `frozen_at: null`
 * (`insertDraftRevision`), which is what the same constraint requires of a
 * `DRAFT`. `products.published_revision_id` is untouched, and that is the
 * column the storefront projection reads (`listing-snapshot.ts`) — so buyers
 * keep seeing the published copy until `Publish Update` runs.
 */
export type OpenDraftForEdit =
  | {
      ok: true;
      revisionId: string;
      expectedVersion: number;
      /** True when this call created the draft, for the caller's audit payload. */
      forked: boolean;
    }
  | { ok: false; reason: 'version_conflict' | 'revision_in_review' };

export default async function openDraftForEdit(
  executor: Executor,
  input: {
    /** Already proven to be stewarded by the caller's seller account. */
    product: ProductRow;
    /** The revision the seller's editor rendered. */
    revisionId: string;
    expectedRevisionVersion: number;
    actorId: string;
  },
): Promise<OpenDraftForEdit> {
  const revision = await findRevisionOfProduct(executor, {
    revisionId: input.revisionId,
    productId: input.product.id,
  });

  if (revision === null) return { ok: false, reason: 'version_conflict' };

  if (revision.workflowState === 'DRAFT') {
    return {
      ok: true,
      revisionId: revision.id,
      expectedVersion: input.expectedRevisionVersion,
      forked: false,
    };
  }

  if (
    revision.workflowState === 'IN_REVIEW' ||
    revision.workflowState === 'CHANGES_REQUESTED'
  ) {
    return { ok: false, reason: 'revision_in_review' };
  }

  // The editor must be looking at the version it is asking to supersede, and
  // at the revision the product currently points at. Either mismatch means a
  // stale screen, which is the answer a stale draft save already gets.
  if (revision.version !== input.expectedRevisionVersion) {
    return { ok: false, reason: 'version_conflict' };
  }

  if (input.product.currentRevisionId !== revision.id) {
    return { ok: false, reason: 'version_conflict' };
  }

  // Cheap pre-check for the ordinary case — a draft another tab already
  // forked. The index below is what actually decides; this only avoids
  // burning a revision number on an insert that would be discarded.
  const openDraft = await findOpenDraftRevision(executor, input.product.id);

  if (openDraft !== null) return { ok: false, reason: 'version_conflict' };

  const document = descriptionDocumentSchema.parse(revision.contentSnapshot);
  const contentChecksum = checksumOfDescriptionDocument(document);
  const highest = await findHighestRevisionNumber(executor, input.product.id);

  const created = await insertDraftRevision(executor, {
    productId: input.product.id,
    revisionNumber: highest + 1,
    expectedProductVersion: input.product.version,
    contentDocument: document,
    contentChecksum,
    actorId: input.actorId,
  });

  // `null` is the open-draft index refusing a second draft: a concurrent fork
  // won the race between the read above and this insert.
  if (created === null) return { ok: false, reason: 'version_conflict' };

  await setCurrentRevision(executor, {
    productId: input.product.id,
    revisionId: created.id,
    actorId: input.actorId,
  });

  await appendAuditEvent(executor, {
    actorId: input.actorId,
    action: PRODUCT_AUDIT_ACTIONS.revisionForked,
    entityType: 'ProductRevision',
    // The new revision, with the source in the payload — the convention every
    // other action in this module follows.
    entityId: created.id,
    payload: {
      productId: input.product.id,
      revisionNumber: created.revisionNumber,
      forkedFromRevisionId: revision.id,
      forkedFromRevisionNumber: revision.revisionNumber,
      forkedFromWorkflowState: revision.workflowState,
      forkedFromRevisionVersion: revision.version,
      forkedFromProductVersion: input.product.version,
      /**
       * Of the snapshot actually copied, so the trail shows the fork started
       * from the exact bytes that were published rather than only that a fork
       * happened. `forkedFromContentChecksum` is what the source row stored
       * for its own document; the two disagreeing would mean a settled row
       * whose snapshot and document had drifted.
       */
      contentChecksum,
      forkedFromContentChecksum: revision.contentChecksum,
    },
  });

  return {
    ok: true,
    revisionId: created.id,
    expectedVersion: created.version,
    forked: true,
  };
}
