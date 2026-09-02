import type { CategoryAttributeSubmissionValidation } from '@/modules/catalog/taxonomy/attribute-types';
import { findProductEditorFixtureForSeller } from './read-model';
import saveCategoryAttributes from './save-category-attributes';
import {
  suggestAttributes,
  type SuggestedAttributes,
  type SupplierProperty,
} from './suggest-attributes-rules';

/**
 * Decide a product's category attributes from its own facts, and optionally
 * write them - one round trip where the automation client used to make two
 * (read snapshot, decide locally, write specifications).
 *
 * The DECIDING is `suggest-attributes-rules.ts`; this file only feeds it the
 * editor's own fixture (the same builder the snapshot route serves, so the
 * fields, options and stored values cannot drift from what a person sees)
 * and, when asked, hands the result to `saveCategoryAttributes` - the same
 * domain function the editor's Server Action calls, partial-save semantics
 * and re-validation included.
 *
 * What the caller still supplies, deliberately:
 *
 * - **`supplierProperties`** - CJ's property table is read off CJ's WEBSITE
 *   by a browser (owner decision: CJ stays browser-read; there is no free
 *   read API). The server cannot fetch it and must not pretend to.
 * - **`known`** - answers only a pair of eyes can give, in practice "what
 *   does the photograph show" (`Pants Type`). They outrank every rule and
 *   cascade into the others.
 *
 * `apply: false` is a dry run a person can read before anything is written.
 */

export type SuggestAttributesResult =
  | {
      ok: false;
      reason: 'not_found' | SaveRefusal;
      suggestion?: SuggestedAttributes;
    }
  | {
      ok: true;
      suggestion: SuggestedAttributes;
      applied: boolean;
      productVersion: number | null;
      validation: CategoryAttributeSubmissionValidation | null;
    };

type SaveRefusal =
  | 'version_conflict'
  | 'NO_CATEGORY_ASSIGNED'
  | 'ATTRIBUTE_CONTROLS_UNAVAILABLE';

export default async function suggestProductAttributes(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  supplierProperties: SupplierProperty[];
  known: Record<string, string>;
  apply: boolean;
  expectedProductVersion: number;
}): Promise<SuggestAttributesResult> {
  const read = await findProductEditorFixtureForSeller(
    input.sellerAccountId,
    input.productId,
  );

  if (read === null) return { ok: false, reason: 'not_found' };

  const { fixture } = read;

  const suggestion = suggestAttributes({
    title: fixture.productName ?? '',
    fields: (fixture.categoryAttributes ?? []).map((field) => ({
      attributeName: field.attributeName,
      requirement: field.requirement,
      allowedValues: field.allowedValues,
      values: field.values,
    })),
    variantLabels: (fixture.variants ?? []).map(
      (variant) => variant.optionLabel ?? '',
    ),
    supplierProperties: input.supplierProperties,
    known: input.known,
  });

  const nothingToWrite = Object.keys(suggestion.decided).length === 0;

  if (!input.apply || nothingToWrite) {
    return {
      ok: true,
      suggestion,
      applied: false,
      productVersion: null,
      validation: null,
    };
  }

  const result = await saveCategoryAttributes({
    productId: input.productId,
    sellerAccountId: input.sellerAccountId,
    actorId: input.actorId,
    expectedProductVersion: input.expectedProductVersion,
    attributes: suggestion.decided,
  });

  if (!result.ok) {
    // `not_found` here would mean the product vanished between the fixture
    // read above and the write - surfaced as itself, not softened.
    return { ok: false, reason: result.reason, suggestion };
  }

  return {
    ok: true,
    suggestion,
    applied: true,
    productVersion: result.productVersion,
    validation: result.validation,
  };
}
