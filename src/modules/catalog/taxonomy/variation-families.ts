import variationFamiliesExtract from '@/lib/db/seed-data/sals3-category-variation-families-v1.json';

/**
 * Turning the taxonomy workbook's variation *families* into a buyer-facing
 * option name the Product Editor can offer as a suggestion.
 *
 * ## Why families and not the tier attribute columns
 *
 * `sals3_category_presets.tier_1_attribute` already holds this sheet's guidance
 * text, but that text is written for a human reading a spec — e.g.
 * `Color / Finish / Material (Stainless/Ceramic/Cast Iron/Black)`. Putting that
 * in a storefront option label is worse than leaving the field blank. The
 * workbook's `Tier 1/2 Attribute Families` columns carry short controlled tokens
 * (`COLOR`, `SIZE`) instead, and those map to a clean label.
 *
 * ## A suggestion, never an answer
 *
 * The workbook knows the *category*. It cannot know what the supplier encoded at
 * each position of its own label: `deriveOptionSplit` proves there are two
 * positions and which tokens sit at each, but nothing in CJ's payload says
 * position 0 is a colour — on a lamp the same slot could be plug type. So a
 * family-derived name is offered to a person and never written unattended, which
 * is why the editor renders it as an accept-it-yourself suggestion rather than
 * pre-filling a saveable value. A wrong suggestion then costs a glance, not a
 * wrong buyer-facing attribute.
 *
 * Consistent with ADR-010's no-silent-automated-decision rule and with
 * `option-split.ts`'s own refusal to name a position.
 *
 * ## Unknown tokens yield no suggestion
 *
 * `FAMILY_AXIS_NAMES` is an allow list. A family absent from it returns `null`,
 * so the seller simply gets no hint — never a guessed or half-translated label.
 * `extract-category-variation-families.mts` refuses to extract an unrecognized
 * token in the first place, so a gap here means the vocabulary changed and this
 * map was not updated with it.
 *
 * Costs nothing at the supplier: pure data already committed to this repository.
 */

/**
 * Family token to buyer-facing option name.
 *
 * Owner-approved 2026-08-18. `COLOR` is `Colour` because Sals3 is an Australian
 * business and the editor's own placeholder already reads "e.g. Colour".
 * `FOOD_BEAUTY` spans flavour, roast, blend, vintage, formula *and* cosmetic
 * shade, so it resolves to the neutral `Variant` — never wrong for either, and
 * one keystroke from the specific word the seller wants.
 */
export const FAMILY_AXIS_NAMES: Record<string, string> = {
  BUNDLE: 'Pack size',
  CAPACITY: 'Capacity',
  COLOR: 'Colour',
  FITMENT: 'Fitment',
  FOOD_BEAUTY: 'Variant',
  MATERIAL: 'Material',
  MODEL_SPEC: 'Model',
  SIZE: 'Size',
};

type VariationPattern = {
  patternCode: string;
  tier1Families: string[];
  tier2Families: string[];
};

const patternsByCode = new Map<string, VariationPattern>(
  variationFamiliesExtract.patterns.map((pattern) => [
    pattern.patternCode,
    pattern,
  ]),
);

const patternCodeByCategoryCode = new Map<string, string>(
  variationFamiliesExtract.categories.map((assignment) => [
    assignment.code,
    assignment.patternCode,
  ]),
);

/**
 * The buyer-facing name for one family cell.
 *
 * The workbook puts several families in one cell when a tier legitimately covers
 * more than one idea (`COLOR; MATERIAL`, 964 categories). The first token wins:
 * the sheet orders them by primacy, and a joined label (`Colour / Material`)
 * would recreate the verbose-label problem this module exists to solve.
 */
export function axisNameForFamilies(families: string[]): string | null {
  const named = families
    .map((family) => FAMILY_AXIS_NAMES[family])
    .find((name) => name !== undefined);

  return named ?? null;
}

/**
 * Suggested axis names for one Sals3 category, tier 1 first.
 *
 * Returns `[]` for a category this taxonomy version does not cover, and `null`
 * inside the array for a tier whose family cell is empty or unrecognized — the
 * caller must keep positional alignment rather than compacting, because index 0
 * means "tier 1" to every consumer.
 */
export function suggestedAxisNamesForCategory(
  categoryCode: string | null,
): (string | null)[] {
  if (categoryCode === null) return [];

  const patternCode = patternCodeByCategoryCode.get(categoryCode);

  if (patternCode === undefined) return [];

  const pattern = patternsByCode.get(patternCode);

  if (pattern === undefined) return [];

  return [
    axisNameForFamilies(pattern.tier1Families),
    axisNameForFamilies(pattern.tier2Families),
  ];
}

/** Provenance for the status census and any audit of where a name came from. */
export const VARIATION_FAMILIES_SOURCE = variationFamiliesExtract.source;
