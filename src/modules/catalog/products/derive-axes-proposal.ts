import { looksLikeASize } from './description-copy-guard';
import { deriveOptionSplit, type LabelledVariant } from './option-split';

/**
 * Name the derived option split's positions, for the internal API's
 * `auto: true` mapping mode.
 *
 * ## The standing rule this narrows, and by whose decision
 *
 * `option-split.ts` derives structure and deliberately never NAMES a
 * position - "the names come from a person, in the editor". That rule stands
 * for the editor. The owner's automation loop (2026-09-02: local scripts may
 * exist, the functions belong in the API) runs the same naming heuristic the
 * client ran on every live product so far: a position where at least half
 * the values read as size tokens is `Size`, any other is `Colour`. This
 * module is that heuristic and nothing more, and it narrows the rule in
 * three ways rather than repealing it:
 *
 * - it only ever names positions `deriveOptionSplit` itself derived, so the
 *   STRUCTURE is still the supplier's own delimiter arithmetic, checked by
 *   the same exactness/compression tests the editor uses - using the
 *   server's own split also removes the drift the client had built in (it
 *   split on the FIRST dash only; the server splits on every one);
 * - a shape the heuristic cannot name safely - two positions resolving to
 *   the SAME name - is a `null`, meaning "map it by hand in the editor",
 *   never a guess;
 * - the caller sees the produced names in the response and the pipeline's
 *   verify stage reads the mapping back, so a wrong name is loud, not
 *   latent.
 */

export type DerivedAxis = {
  name: string;
  values: { raw: string; label: string }[];
};

export default function deriveAxesProposal(
  variants: LabelledVariant[],
): DerivedAxis[] | null {
  const proposal = deriveOptionSplit(variants);

  if (proposal === undefined || proposal.positions.length === 0) return null;

  const nameFor = (values: readonly string[]): string => {
    const sized = values.filter((value) => looksLikeASize(value)).length;

    return sized >= Math.max(1, Math.floor(values.length / 2))
      ? 'Size'
      : 'Colour';
  };

  const axes = proposal.positions.map((position) => ({
    name: nameFor(position.values),
    values: position.values.map((raw) => ({ raw, label: raw })),
  }));

  const names = new Set(axes.map((axis) => axis.name));

  // Two `Colour` axes (or two `Size` axes) is a product the heuristic does
  // not understand - a person names those in the editor.
  return names.size === axes.length ? axes : null;
}
