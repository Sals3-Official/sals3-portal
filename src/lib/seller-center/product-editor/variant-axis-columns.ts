import type { VariantFixture } from './types';

/**
 * Turning the variant table's one `Variant` cell into a column per option axis.
 *
 * `optionLabel` arrives pre-formatted by the read-model: `"Colour: Army Green,
 * Size: XL"` once the Variant Matrix is mapped, or the supplier's own
 * concatenated token (`"Army Green-XL"`) when it is not. This reads the mapped
 * form back into axes so the table can put `Colour` and `Size` in their own
 * columns, with only the value in each cell — the axis name moves to the header
 * instead of repeating on all sixteen rows.
 *
 * ## Why it refuses rather than guesses
 *
 * Splitting is offered only when **every** variant parses into the same axis
 * names in the same order. A table whose columns came from the first row would
 * silently drop a value from any row shaped differently, and the seller has no
 * way to see that a column is missing. One disagreement and the whole table
 * falls back to the single `Variant` column, which shows the label whole.
 *
 * That also covers the unmapped product for free: a raw supplier token has no
 * `": "` pairs, so it never parses, so it is never split.
 *
 * ## Not a source of truth
 *
 * This is presentation derived from a string. The variant's identity is
 * `option_combination_key`, built from the supplier's own token, and nothing
 * here is written anywhere or sent to any action.
 */

export type VariantAxisColumns = {
  /** Axis names in the order the read-model emitted them. */
  names: string[];
  /** Values per variant id, aligned index-for-index with `names`. */
  valuesByVariantId: Record<string, string[]>;
};

const PAIR_SEPARATOR = ', ';
const NAME_VALUE_SEPARATOR = ': ';

/** `"Colour: Army Green"` → `['Colour', 'Army Green']`, or null. */
function splitPair(pair: string): [string, string] | null {
  const at = pair.indexOf(NAME_VALUE_SEPARATOR);

  if (at <= 0) return null;

  const name = pair.slice(0, at);
  const value = pair.slice(at + NAME_VALUE_SEPARATOR.length);

  // A value may itself contain `: ` — `Strap: Buckle: wide` is one axis with a
  // colon in its value, so only the first separator splits.
  return name.trim() === '' || value.trim() === '' ? null : [name, value];
}

function parseLabel(
  label: string,
): { names: string[]; values: string[] } | null {
  const pairs = label.split(PAIR_SEPARATOR);
  const parsed = pairs.map(splitPair);

  if (parsed.some((pair) => pair === null)) return null;

  const complete = parsed.filter(
    (pair): pair is [string, string] => pair !== null,
  );

  return {
    names: complete.map(([name]) => name),
    values: complete.map(([, value]) => value),
  };
}

export default function resolveVariantAxisColumns(
  variants: VariantFixture[],
): VariantAxisColumns | null {
  if (variants.length === 0) return null;

  const parsed = variants.map((variant) => ({
    id: variant.id,
    label: parseLabel(variant.optionLabel),
  }));
  const first = parsed[0]?.label;

  if (first === undefined || first === null) return null;

  // Same axes, same order, on every row — see "Why it refuses rather than
  // guesses" above.
  const consistent = parsed.every(
    ({ label }) =>
      label !== null &&
      label.names.length === first.names.length &&
      label.names.every((name, index) => name === first.names[index]),
  );

  if (!consistent) return null;

  return {
    names: first.names,
    valuesByVariantId: Object.fromEntries(
      parsed.map(({ id, label }) => [id, label?.values ?? []]),
    ),
  };
}
