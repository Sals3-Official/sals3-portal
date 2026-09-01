import assignVariantMedia from './assign-variant-media';
import { findProductEditorFixtureForSeller } from './read-model';
import {
  planAssignments,
  type AssignBySourceResult,
  type SourceCodeAssignment,
  type SourceCodeOutcome,
} from './variant-media-source-plan';

export type {
  AssignBySourceResult,
  SourceCodeAssignment,
  SourceCodeOutcome,
} from './variant-media-source-plan';

/**
 * Point one photo at each first-axis value, addressed by the CJ image code
 * in the photo's own stored address.
 *
 * ## The last browser write, moved server-side
 *
 * Until 2026-09-02 this was the one Portal write automation still did by
 * driving the editor: open the picker, click a tile, read the button label
 * back. Every fact it clicked on is already in the database:
 *
 * - a supplier photo's `source_url` still carries CJ's own image code
 *   (`cf.cjdropshipping.com/<code>.jpg...`), so the code IS the identity -
 *   no perceptual hash, no picker;
 * - the first variant of each first-axis value is derivable from the
 *   variant labels the editor itself renders;
 * - the write is `assignVariantMedia`, the same domain function the picker's
 *   Server Action calls.
 *
 * The `colour -> code` input still comes from a browser, deliberately: it is
 * read off CJ's page (`--cj-variants`), which stays a page load because CJ
 * has no free read API and the swatches are pictures.
 *
 * ## The refusals, and why each exists
 *
 * Assigning MOVES a photo - `product_media_sources.variant_id` is one
 * column - so every wrong write un-does a right one somewhere else. These
 * are the proven rules of the browser tool (`map_collisions`,
 * `selectable_digests`, "never steal an assigned photo"), kept:
 *
 * - two values naming one code refuse the WHOLE plan: the capture cannot
 *   tell them apart, and a partial write against it still moves photos
 *   wrongly;
 * - a code matching no stored photo, or more than one, refuses that value
 *   by name and assigns the rest;
 * - a photo already pointed at a DIFFERENT variant is refused, never taken
 *   back;
 * - a photo already on the right variant reports `already_done` - so the
 *   whole call is idempotent and safe to re-run.
 *
 * One photo per first-axis value, on the FIRST variant of that value: the
 * storefront's `shareFirstAxisPhotos` gives every size under a colour that
 * colour's photo, so more writes than that add nothing and move things.
 */

export default async function assignVariantMediaBySource(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  assignments: SourceCodeAssignment[];
}): Promise<AssignBySourceResult> {
  // The same builder the editor renders from, so the labels and media this
  // plans against cannot drift from what a person sees - the exact reason
  // the snapshot route reuses it too.
  const read = await findProductEditorFixtureForSeller(
    input.sellerAccountId,
    input.productId,
  );

  if (read === null) return { ok: false, reason: 'not_found' };

  const { fixture } = read;
  const plan = planAssignments(
    (fixture.variants ?? []).map((variant) => ({
      id: variant.id,
      optionLabel: variant.optionLabel,
    })),
    fixture.assignableMedia ?? [],
    input.assignments,
  );

  if (plan.refused !== null) {
    return { ok: false, reason: 'plan_refused', detail: plan.refused };
  }

  const outcomes = [...plan.outcomes];
  let assigned = 0;

  // Sequential, not parallel: each write moves a row, and the refusal rules
  // above were computed against a single read. Racing them against each
  // other would re-introduce exactly the collision they exist to prevent.
  // eslint-disable-next-line no-restricted-syntax -- ordered writes, see above.
  for (const write of plan.writes) {
    // eslint-disable-next-line no-await-in-loop
    const result = await assignVariantMedia({
      productId: input.productId,
      mediaId: write.mediaId,
      variantId: write.variantId,
      sellerAccountId: input.sellerAccountId,
      actorId: input.actorId,
    });

    if (result.ok) {
      assigned += 1;
      outcomes.push({
        firstAxisValue: write.firstAxisValue,
        outcome: 'assigned',
        mediaId: write.mediaId,
        variantId: write.variantId,
        reason: null,
      });
    } else {
      outcomes.push({
        firstAxisValue: write.firstAxisValue,
        outcome: 'refused',
        mediaId: write.mediaId,
        variantId: write.variantId,
        reason: result.reason,
      });
    }
  }

  return { ok: true, outcomes, assigned };
}
