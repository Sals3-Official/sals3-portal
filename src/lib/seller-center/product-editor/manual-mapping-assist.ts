/**
 * The two pure pieces of by-hand option mapping: reading a seller's list of
 * values, and offering a first pass at which value each variant takes.
 *
 * Kept out of the component because both are decisions worth testing directly,
 * and because the suggestion in particular has to be provably conservative.
 */

/**
 * How many variants one by-hand mapping may carry.
 *
 * A payload bound, not a product opinion: the write is one transaction of three
 * inserts per variant, and a request past this is a paging problem rather than a
 * mapping one. The live tactical pants is 52 and the largest published product is
 * 42, so this is headroom rather than a limit anyone meets.
 *
 * Shared by the server action's schema and the panel, so the panel can say why it
 * is not offering a save instead of letting the action refuse with
 * `invalid_input` — whose message names option groups and would be simply wrong
 * about the reason.
 */
export const MANUAL_MAPPING_MAX_VARIANTS = 400;

/**
 * A seller's typed values, one per line or comma-separated.
 *
 * Both separators are accepted because both are what people actually type, and
 * neither can appear inside a value without being meant as a separator — a
 * colour called `Black, Gray` is two colours to every reader.
 *
 * Duplicates are dropped case-insensitively rather than passed through: the
 * server refuses them (`product_option_values_option_normalized_key` cannot hold
 * `Black` twice), and refusing a save over a value the seller typed twice by
 * accident is a worse answer than accepting the one they meant.
 */
export function parseAxisValues(text: string): string[] {
  const seen = new Set<string>();

  return text
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => {
      const key = value.toLocaleLowerCase();

      if (seen.has(key)) return false;

      seen.add(key);

      return true;
    });
}

/**
 * Which value of an axis a supplier label appears to carry, or `undefined`.
 *
 * Substring matching on the label, case-insensitively, **longest value first**.
 * The ordering is the whole correctness argument: `Black Men` contains both `Men`
 * and `Me`, and on a fit axis holding `Men` and `Women` the label `Black Women`
 * contains `Men` as well. Testing the longest candidate first makes `Women` win
 * on that label, which is the only reading a person would agree with.
 */
export function matchAxisValue(
  label: string,
  values: string[],
): string | undefined {
  const haystack = label.toLocaleLowerCase();

  return [...values]
    .sort((left, right) => right.length - left.length)
    .find((value) => haystack.includes(value.toLocaleLowerCase()));
}

export type SuggestedAssignments = Record<string, (string | undefined)[]>;

/**
 * A first pass at the whole table, for the seller to review.
 *
 * ## Offered, never applied on its own
 *
 * This is a suggestion in a form control, which is the precedent the axis-name
 * suggestion already set: the seller presses a button, sees every row fill, and
 * the save still requires them to submit. Nothing here reaches the database
 * without that.
 *
 * ## A gap is left as a gap
 *
 * A value this cannot find is `undefined`, never a guess at the first value in
 * the list. The save is blocked until every gap is closed by a person, so the
 * cost of a miss is one dropdown rather than a wrong attribute on a live
 * listing — and a wrong colour on the wrong variant is exactly what the
 * never-split rule exists to prevent. Filling gaps with a default would move
 * this from an assistant to an inventor.
 *
 * On the real tactical pants this fills `Size` and `Colour` cleanly and leaves
 * gender partly gapped, because the supplier spells it `Male`, `Men`, `Female`
 * and `Women` across one product — the mess that makes this a human job.
 */
export function suggestAssignments(
  variants: { variantId: string; label: string }[],
  axes: { values: string[] }[],
): SuggestedAssignments {
  const suggestions: SuggestedAssignments = {};

  variants.forEach((variant) => {
    suggestions[variant.variantId] = axes.map((axis) =>
      matchAxisValue(variant.label, axis.values),
    );
  });

  return suggestions;
}

/**
 * A saved mapping back into the by-hand editor's own shape, for replacing it.
 *
 * `MappedOptionAxis.values[].variantIds` already holds every variant carrying
 * each value — it exists so a value's photo can be found — which is exactly the
 * assignment, inverted. So pre-filling the editor with the current mapping needs
 * no new query and no new column.
 *
 * A value with no `variantIds` (the illustrative fixtures carry none) yields no
 * assignment for it, and the panel then shows those cells empty rather than
 * guessing — the same rule `suggestAssignments` follows.
 */
export function assignmentsFromMappedAxes(
  variantIds: string[],
  axes: { values: { label: string; variantIds?: string[] }[] }[],
): SuggestedAssignments {
  const assignments: SuggestedAssignments = {};

  variantIds.forEach((variantId) => {
    assignments[variantId] = axes.map(
      (axis) =>
        axis.values.find((value) =>
          (value.variantIds ?? []).includes(variantId),
        )?.label,
    );
  });

  return assignments;
}

/** How many axis cells across the whole table still have no value. */
export function countUnassigned(
  variants: { variantId: string }[],
  assignments: SuggestedAssignments,
  axisCount: number,
): number {
  return variants.reduce((total, variant) => {
    const row = assignments[variant.variantId] ?? [];

    return (
      total +
      Array.from({ length: axisCount }).filter(
        (_cell, index) => row[index] === undefined || row[index]?.trim() === '',
      ).length
    );
  }, 0);
}
