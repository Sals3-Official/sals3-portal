import type { ProductRow } from '@/lib/db/schema';
import {
  appendAuditEvent,
  type Executor,
} from '@/modules/catalog/candidates/repository';

import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import {
  findRevisionOfProduct,
  freezeDraftRevisionAsSuperseded,
  setCurrentRevision,
} from './repository';

/**
 * Abandons the open `DRAFT` a published product was forked into, putting the
 * product back on the copy the storefront is already serving.
 *
 * ## Why this exists
 *
 * `openDraftForEdit` forks a draft the moment a seller saves anything on a
 * published product, and points `products.current_revision_id` at that fork.
 * Nothing retired it again, so an edit the seller thought better of had no way
 * back: the abandoned copy stayed the current revision, and the next
 * `Publish Update` — pressed for some later, unrelated change — shipped it.
 * The seller's only escape was to retype the published wording from memory and
 * hope they matched it.
 *
 * Buyers were never exposed. `products.published_revision_id` is untouched by
 * a fork, which is what keeps the storefront on the published copy until a
 * publish runs. This closes the *seller-facing* half: an edit is now
 * reversible before it is live.
 *
 * ## Why the draft is frozen rather than deleted
 *
 * `product_revisions_frozen_when_settled` (`product-catalog.ts`) admits
 * `SUPERSEDED` only for a row carrying both `content_snapshot` and
 * `frozen_at`, and a `DRAFT` carries neither by design. So the discard writes
 * the draft's own `content_document` into its snapshot and freezes it.
 *
 * That is the honest record rather than a workaround for the constraint. The
 * archive dialog on the Product Catalogue already promises archiving "never
 * deletes the product, revision, supplier evidence, or audit history", and a
 * discard is a smaller act than an archive — it must not be the one path that
 * destroys a revision. The snapshot preserves exactly what was thrown away, so
 * the audit trail can answer *what* was discarded and not merely *that*
 * something was.
 *
 * Moving the row out of `DRAFT` also releases
 * `product_revisions_open_draft_key`, the partial unique index that permits one
 * open draft per product — so the seller's next edit can fork again. A
 * hard delete would have done that too; freezing does it without losing the
 * bytes.
 *
 * ## What it refuses, and why each refusal is not a loosening
 *
 * - **Not this product's revision, or gone.** `version_conflict`. The caller
 *   has proven stewardship of the product, never of an arbitrary revision id.
 * - **Not a `DRAFT`.** `version_conflict`. A settled revision is immutable
 *   (spec §16) and there is nothing to abandon. This is what stops a discard
 *   being repurposed into an unpublish: retiring the *published* revision is
 *   `unpublishProduct`'s job, and it moves the product to `PAUSED` rather than
 *   leaving it published from a superseded row.
 * - **Version mismatch.** `version_conflict`, and re-asserted inside
 *   `freezeDraftRevisionAsSuperseded`'s own `WHERE` — a stale tab must not
 *   discard an edit made in a newer one, which is the one refusal here whose
 *   absence would lose real work.
 * - **Never published.** `no_published_revision`. On an unpublished product the
 *   open draft is the *only* copy, and discarding it would leave a product with
 *   no revision to point at. A distinct reason rather than `version_conflict`
 *   because nothing about the seller's screen is stale — the action simply does
 *   not apply, and telling them to refresh would be a lie.
 * - **The draft is already the published revision.** `version_conflict`.
 *   Unreachable — `publish.ts` freezes to `APPROVED`, so a `DRAFT` cannot be
 *   the published row — and guarded anyway, because the cost of being wrong is
 *   a product published from a superseded revision.
 * - **Not the current revision.** `version_conflict`. A matching version token
 *   does not prove the screen is current: another tab may have forked and
 *   published since, and restoring `published_revision_id` from this stale view
 *   would drop that newer work.
 *
 * `products.version` is deliberately *not* bumped, mirroring the fork —
 * `insertDraftRevision`/`setCurrentRevision` do not bump it either. The
 * revision compare-and-set is the real guard, exactly as it is for
 * `saveDraftRevisionContent`, and bumping the product token here would refuse
 * the seller's very next product-level write for no reason.
 */
export type DiscardDraftRevision =
  | {
      ok: true;
      /** The published revision the product now points at again. */
      restoredRevisionId: string;
      /**
       * Its version, so the editor can keep saving without a remount.
       *
       * Returned rather than left for the client to re-read: the editor holds
       * the revision id and version in `useState`, which only reads its
       * argument on mount, so a `router.refresh()` after this would re-render
       * with a fresh fixture and *keep* pointing at the revision this call just
       * retired — every later save refused as `version_conflict`. That is the
       * stale-`useState` defect PR #105 already fixed once on this screen.
       * Handing back the new tokens is deterministic where a resync is a rule
       * someone has to remember.
       */
      restoredRevisionVersion: number;
      discardedRevisionId: string;
    }
  | { ok: false; reason: 'version_conflict' | 'no_published_revision' };

export default async function discardDraftRevision(
  executor: Executor,
  input: {
    /** Already proven to be stewarded by the caller's seller account. */
    product: ProductRow;
    /** The draft revision the seller's editor rendered. */
    revisionId: string;
    expectedRevisionVersion: number;
    actorId: string;
    now: Date;
  },
): Promise<DiscardDraftRevision> {
  const revision = await findRevisionOfProduct(executor, {
    revisionId: input.revisionId,
    productId: input.product.id,
  });

  if (revision === null) return { ok: false, reason: 'version_conflict' };

  if (revision.workflowState !== 'DRAFT') {
    return { ok: false, reason: 'version_conflict' };
  }

  if (revision.version !== input.expectedRevisionVersion) {
    return { ok: false, reason: 'version_conflict' };
  }

  const { publishedRevisionId } = input.product;

  // Checked before the current-revision test below, so an unpublished product
  // gets the reason that names its actual situation rather than being told its
  // screen is stale.
  if (publishedRevisionId === null || publishedRevisionId === undefined) {
    return { ok: false, reason: 'no_published_revision' };
  }

  if (publishedRevisionId === revision.id) {
    return { ok: false, reason: 'version_conflict' };
  }

  if (input.product.currentRevisionId !== revision.id) {
    return { ok: false, reason: 'version_conflict' };
  }

  // Read before writing: the caller needs this row's version to keep saving,
  // and a published revision that cannot be read is a damaged database rather
  // than something to discover halfway through a discard.
  const published = await findRevisionOfProduct(executor, {
    revisionId: publishedRevisionId,
    productId: input.product.id,
  });

  if (published === null) return { ok: false, reason: 'version_conflict' };

  const frozen = await freezeDraftRevisionAsSuperseded(executor, {
    revisionId: revision.id,
    productId: input.product.id,
    expectedVersion: input.expectedRevisionVersion,
    actorId: input.actorId,
    now: input.now,
  });

  // `null` is the compare-and-set losing: another writer saved to this draft
  // between the read above and this update. Refused rather than retried,
  // because the edit that won is work this seller has not seen.
  if (frozen === null) return { ok: false, reason: 'version_conflict' };

  await setCurrentRevision(executor, {
    productId: input.product.id,
    revisionId: publishedRevisionId,
    actorId: input.actorId,
  });

  await appendAuditEvent(executor, {
    actorId: input.actorId,
    action: PRODUCT_AUDIT_ACTIONS.revisionDiscarded,
    entityType: 'ProductRevision',
    entityId: revision.id,
    payload: {
      productId: input.product.id,
      revisionNumber: revision.revisionNumber,
      restoredRevisionId: publishedRevisionId,
      /**
       * The checksum of the discarded document, so the trail records which
       * copy was thrown away and not only that a discard happened. The bytes
       * themselves survive in `content_snapshot` on the superseded row.
       */
      discardedContentChecksum: revision.contentChecksum,
      discardedRevisionVersion: revision.version,
      productVersion: input.product.version,
    },
  });

  return {
    ok: true,
    restoredRevisionId: publishedRevisionId,
    restoredRevisionVersion: published.version,
    discardedRevisionId: revision.id,
  };
}
