/**
 * Corrections to the frozen attribute-controls extract.
 *
 * ## Why these are not edits to the extract itself
 *
 * `sals3-category-attribute-controls-v1.json` records the workbook it came
 * from, that workbook's `sha256`, and its own row count. Editing rows inside it
 * would make the file misdescribe itself — it would no longer be the extract it
 * says it is — and a later re-extraction of the same workbook would silently
 * reintroduce whatever had been hand-removed.
 *
 * So the extract stays a faithful record of the workbook, and the deviations
 * live here, where each one carries its reason. A re-extraction re-applies
 * them rather than losing them.
 *
 * ## One declaration, two consumers
 *
 * `seedAttributeControlsData` applies these before inserting, so a fresh
 * environment never gets the wrong controls in the first place. The
 * `correct-attribute-controls` break-glass endpoint applies the same list to
 * rows already in a deployed database, because that seed is additive-only
 * (`onConflictDoNothing`) and can never remove anything it once wrote.
 *
 * If the two ever disagreed, a fresh environment and production would offer
 * sellers different fields for the same category — which is the class of defect
 * this file exists to end, not to create.
 */

/**
 * Four leaf categories that are skirts and nothing else.
 *
 * `CAT-GGL-1516 Skirt Suits` is deliberately absent: a skirt suit includes a
 * jacket, so its neckline and sleeves are real attributes of the product.
 */
export const SKIRT_ONLY_CATEGORY_CODES = [
  'CAT-GGL-1581', // Clothing > Skirts
  'CAT-GGL-2331', // Clothing > Skirts > Mini Skirts
  'CAT-GGL-6228', // Clothing > Skirts > Long Skirts
  'CAT-GGL-6229', // Clothing > Skirts > Knee-Length Skirts
] as const;

/**
 * A control that should never have applied to this category.
 *
 * The workbook wrote one attribute set for "Dresses & Skirts" as a single
 * family and laid it over the skirt leaves too, so a skirt was asked for its
 * neckline and its sleeve style. Nine sibling categories that really are
 * dresses (Dresses, Wedding Dresses, Nightgowns) keep both, correctly.
 */
export type RemovedControl = {
  categoryCode: string;
  attributeName: string;
};

/**
 * A control that belongs on the category but was offering values that do not.
 *
 * Narrowing an allow list cannot strand a seller here: `Dress / Skirt Style`
 * carries `allowCustomValue: true`, so a value already stored on a published
 * product — `Maxi Dress` on a live skirt — is still accepted as a custom value
 * rather than refused. It simply stops being offered to the next seller.
 */
export type NarrowedControlValues = {
  categoryCode: string;
  attributeName: string;
  allowedValues: string[];
};

/** Both attributes describe a garment's top half. A skirt has no top half. */
const REMOVED_ATTRIBUTE_NAMES = ['Neckline', 'Sleeve Style'] as const;

/**
 * What is left after the dresses are taken out.
 *
 * `A-Line` stays because it describes a skirt as readily as a dress.
 * `Pleated Skirt`, `Pencil Skirt` and `Tiered Boho` name skirts outright. The
 * six that go — `Maxi Dress`, `Midi Dress`, `Mini Dress`, `Wrap Dress`,
 * `Slip Dress`, `Bodycon` — either say "Dress" in the value a buyer would read
 * back, or name a dress silhouette.
 *
 * The three length-shaped values are not replaced with skirt equivalents on
 * purpose: `Dress / Skirt Length` is its own control on these categories, and
 * a second field answering the same question is how two fields start
 * disagreeing.
 */
const SKIRT_STYLE_ALLOWED_VALUES = [
  'A-Line',
  'Pleated Skirt',
  'Pencil Skirt',
  'Tiered Boho',
];

export const REMOVED_CONTROLS: RemovedControl[] =
  SKIRT_ONLY_CATEGORY_CODES.flatMap((categoryCode) =>
    REMOVED_ATTRIBUTE_NAMES.map((attributeName) => ({
      categoryCode,
      attributeName,
    })),
  );

export const NARROWED_CONTROL_VALUES: NarrowedControlValues[] =
  SKIRT_ONLY_CATEGORY_CODES.map((categoryCode) => ({
    categoryCode,
    attributeName: 'Dress / Skirt Style',
    allowedValues: SKIRT_STYLE_ALLOWED_VALUES,
  }));

type ControlRow = {
  categoryCode: string;
  attributeName: string;
  allowedValues: string[];
};

function keyOf(categoryCode: string, attributeName: string): string {
  return `${categoryCode}::${attributeName}`;
}

const REMOVED_KEYS = new Set(
  REMOVED_CONTROLS.map((entry) =>
    keyOf(entry.categoryCode, entry.attributeName),
  ),
);

const NARROWED_BY_KEY = new Map(
  NARROWED_CONTROL_VALUES.map((entry) => [
    keyOf(entry.categoryCode, entry.attributeName),
    entry.allowedValues,
  ]),
);

/**
 * The extract as it should actually be seeded.
 *
 * Pure and generic over the row shape, so the seeder can pass its own extract
 * rows through without this module needing to know the whole schema.
 */
export function applyAttributeControlCorrections<Row extends ControlRow>(
  controls: readonly Row[],
): Row[] {
  return controls
    .filter(
      (row) => !REMOVED_KEYS.has(keyOf(row.categoryCode, row.attributeName)),
    )
    .map((row) => {
      const narrowed = NARROWED_BY_KEY.get(
        keyOf(row.categoryCode, row.attributeName),
      );

      return narrowed === undefined ? row : { ...row, allowedValues: narrowed };
    });
}
