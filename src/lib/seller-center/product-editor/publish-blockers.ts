import { isSals3TaxonomyCode } from '@/lib/products/sals3-category-code';
import { minimumRetailAmountMinorForSupplierCost } from '@/lib/pricing/retail-price-floor';
import {
  PUBLISH_GATES,
  type PublishGateReason,
} from '@/lib/products/publish-gates';
import type { ProductEditorFixture, ReadinessIssue } from './types';

/**
 * The publication gates the editor can decide for itself, as readiness blockers.
 *
 * Before this existed the panel knew three of `publish.ts`'s eleven refusals, so
 * a seller could read `Ready`, press Publish, and be refused for a reason the
 * screen had never mentioned. Each gate below is one the editor's own projection
 * settles; the rest are marked `predictableInEditor: false` in the catalogue,
 * with the reason each cannot be answered here.
 *
 * ## Over-warning is the failure mode to fear
 *
 * A missing warning costs a seller one refused Publish — the same refusal they
 * would have got anyway. A false blocker stops a listing that could have gone
 * live, and it cannot be argued with. So every condition here is written to be
 * *no stricter* than the server's, and where the projection is ambiguous the gate
 * is left out rather than guessed:
 *
 * - `NO_ACTIVE_SUPPLIER_BINDING` is omitted even though the fixture carries
 *   `supplierVariantId`. The server tests it for `null`; the fixture types it as
 *   a plain `string`, so an absent binding and an empty one are indistinguishable
 *   here and a blocker would fire on the wrong products.
 * - `NO_APPROVED_MEDIA` fires only when there is no seller upload **and** the
 *   supplier photo is switched off. With it on, publication projects the
 *   supplier's own image and succeeds, so testing `media.length === 0` alone
 *   would block half the catalogue.
 * - `RETAIL_BELOW_SUPPLIER_COST` compares the 2.5% floor only within one
 *   currency. The server refuses an incomparable pair too, but the editor has no
 *   approved FX source, and inventing a conversion to raise a money blocker is
 *   worse than staying quiet.
 */

function issue(
  fixture: ProductEditorFixture,
  reason: PublishGateReason,
  affectedScope: string,
): ReadinessIssue {
  const gate = PUBLISH_GATES[reason];

  return {
    id: `${fixture.fixtureKey}-gate-${reason.toLowerCase()}`,
    severity: 'BLOCKER',
    title: gate.title,
    explanation: gate.explanation,
    affectedScope,
    source: 'AUTOMATED_VALIDATION',
    section: gate.section,
    // `reasonCode` is the screening vocabulary (`NO_STOCK`, `POLICY_BLOCKED`, …),
    // not the publication one. A publish gate has no screening code, and forcing
    // one in would mislabel it in every consumer that reads that field.
    reasonCode: null,
    resolution: gate.resolution,
  };
}

/** The same test `publish.ts` applies: a CJ mirror is not a Sals3 category. */
function needsSals3Category(fixture: ProductEditorFixture): boolean {
  return (
    !isSals3TaxonomyCode(fixture.sals3CategoryCode) ||
    fixture.categoryMappingConfidence === 'UNMAPPED' ||
    fixture.categoryMappingConfidence === 'AMBIGUOUS'
  );
}

/**
 * Named but unmapped: the supplier's labels split into two or more buyer options
 * and nobody has named them. `mappingBlocksPublish` is the server's own answer to
 * "would publication refuse this", so it is used rather than re-derived.
 */
function needsOptionNames(fixture: ProductEditorFixture): boolean {
  return (
    fixture.optionMapping.mappingBlocksPublish &&
    fixture.optionMapping.mappedAxisNames.length === 0
  );
}

/**
 * The parts of the product a seller edits without saving.
 *
 * Passed in rather than read off `fixture`, because `fixture` is the server's
 * snapshot from page load and these three change under the seller's hands. Read
 * from the snapshot, a gate reports the state the page opened in: switching a
 * variant on left `No variant is listed` standing, which reads as a toggle that
 * does not work rather than a panel that is not listening.
 */
export type EditorLiveState = {
  variants: ProductEditorFixture['variants'];
  media: ProductEditorFixture['media'];
  showSupplierPhoto: boolean;
};

export default function predictPublishBlockers(
  fixture: ProductEditorFixture,
  live: EditorLiveState,
): ReadinessIssue[] {
  const blockers: ReadinessIssue[] = [];
  const { variants, media, showSupplierPhoto } = live;

  if (needsSals3Category(fixture)) {
    blockers.push(
      issue(fixture, 'SALS3_CATEGORY_REQUIRED', 'Basic Information'),
    );
  }

  if (needsOptionNames(fixture)) {
    blockers.push(issue(fixture, 'OPTIONS_UNMAPPED', 'Variant Matrix'));
  }

  if (variants.length > 0 && variants.every((v) => !v.enabled)) {
    blockers.push(issue(fixture, 'NO_ACTIVE_VARIANT', 'Variants & Pricing'));
  }

  if (
    variants.length > 0 &&
    variants.every((v) => v.supplierCost.amountMinor <= 0)
  ) {
    blockers.push(issue(fixture, 'NO_SUPPLIER_COST', 'Variants & Pricing'));
  }

  if (media.length === 0 && !showSupplierPhoto) {
    blockers.push(issue(fixture, 'NO_APPROVED_MEDIA', 'Product media'));
  }

  const belowCost = variants.filter(
    (variant) =>
      variant.enabled &&
      variant.retailPrice.currency === variant.supplierCost.currency &&
      variant.retailPrice.amountMinor > 0 &&
      variant.retailPrice.amountMinor <
        minimumRetailAmountMinorForSupplierCost(
          variant.supplierCost.amountMinor,
        ),
  );

  if (belowCost.length > 0) {
    blockers.push(
      issue(
        fixture,
        'RETAIL_BELOW_SUPPLIER_COST',
        belowCost.length === 1
          ? (belowCost[0]?.optionLabel ?? 'Variants & Pricing')
          : `${belowCost.length} variants`,
      ),
    );
  }

  return blockers;
}
