/**
 * Recovering the option structure a supplier encoded in a concatenated variant
 * label, so a seller can confirm it instead of retyping ten combinations.
 *
 * ## What this derives, and what it refuses to
 *
 * CJ sends one string per variant — `variantKey`, e.g. `Black-1XL` or
 * `Army Green-XL` — reaching us as `provider_variant_references.source_option_label`.
 * There are no structured attribute pairs anywhere in CJ's payload, only that
 * string and a space-delimited spelling of it.
 *
 * `create-draft.ts` and `evidence.ts` both record the standing rule: a label is
 * **never split into Sals3 option axes**. Its stated reason is precise — guessing
 * which token is a colour, and a wrong guess becoming a customer-facing product
 * attribute. This module respects that reason rather than routing around it:
 *
 * - It **derives** how many positions there are and which values appear at each.
 *   That is arithmetic on the supplier's own delimiter, checked per product by
 *   the cross-product test below.
 * - It **never names** a position. Nothing in the payload says position 0 is a
 *   "Colour"; on a phone the same two slots could be plug type and storage. The
 *   names come from a person, in the editor, and only from there.
 *
 * So the output is a *proposal* for a human to confirm and name. It is not a
 * mapping, and nothing may write `product_options` from it unattended.
 *
 * ## Why the cross-product test must be exact
 *
 * Splitting is only safe when the result is provably complete. Ten variants
 * yielding token sets of 2 and 5 means 2 × 5 = 10 — every combination present
 * exactly once, nothing left to infer. Anything less (ragged token counts, a
 * missing combination, a duplicate, a single token, a position that never varies)
 * means the label is not a clean encoding, and the seller must map it by hand.
 *
 * Costs nothing at the supplier: the labels are already stored. No CJ call.
 */

/** CJ's own delimiter — the character it joins on, not a guess. */
const DELIMITER = '-';

export type LabelledVariant = {
  variantId: string;
  /** `source_option_label`, verbatim. Absent when the supplier reported none. */
  label: string | null;
};

export type OptionSplitPosition = {
  /** Zero-based position in the supplier's own token order. Not a meaning. */
  index: number;
  /** Distinct values at this position, in first-seen order. */
  values: string[];
};

export type OptionSplitProposal = {
  positions: OptionSplitPosition[];
  /** Variant id per full combination, keyed by its tokens rejoined. */
  byCombination: Map<string, string>;
};

/** The supplier's tokens for one label, in its own order. */
export function splitLabelTokens(label: string): string[] {
  return label
    .split(DELIMITER)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/** The key `byCombination` is stored under. */
export function combinationKeyOf(tokens: string[]): string {
  return tokens.join(DELIMITER);
}

/**
 * A proposal, or `undefined` when the labels do not encode one cleanly.
 *
 * `undefined` is a normal, expected answer — most products will need manual
 * mapping — so callers must treat it as "nothing to pre-fill", never an error.
 *
 * A named export and not a default, deliberately. `scripts/` runs under `tsx`,
 * which loads a `.ts` module imported from an `.mts` file through CommonJS
 * interop: a default export arrives wrapped in the module object rather than as
 * the function, so `typeof` reports `object` and calling it throws. Nothing warns
 * first — the types say it is a function, and `npm run verify` executes nothing in
 * `scripts/`.
 *
 * The backfill script hit exactly that, on its first product with a stored
 * snapshot. Every other working script in `scripts/` imports named bindings from
 * `src/`; keeping only a named export here means the next one cannot get it wrong.
 */
export function deriveOptionSplit(
  variants: LabelledVariant[],
): OptionSplitProposal | undefined {
  // Two variants is the minimum that can encode a grid, and every variant must
  // carry a label: a partial proposal would silently omit the unlabelled ones.
  if (variants.length < 2) return undefined;
  if (variants.some((variant) => variant.label === null)) return undefined;

  const tokenised = variants.map((variant) =>
    splitLabelTokens(variant.label ?? ''),
  );
  const width = tokenised[0]?.length ?? 0;

  // One token carries no structure; a ragged set is not an encoding.
  if (width < 2) return undefined;
  if (tokenised.some((tokens) => tokens.length !== width)) return undefined;

  const values: string[][] = Array.from({ length: width }, () => []);

  tokenised.forEach((tokens) => {
    tokens.forEach((token, index) => {
      const bucket = values[index];

      if (bucket !== undefined && !bucket.includes(token)) bucket.push(token);
    });
  });

  // A position with one value is a constant sitting inside the label, not an
  // axis — offering it as a choice would invent a decision the buyer never has.
  if (values.some((bucket) => bucket.length < 2)) return undefined;

  const expected = values.reduce((total, bucket) => total * bucket.length, 1);

  if (expected !== variants.length) return undefined;

  const byCombination = new Map<string, string>();

  tokenised.forEach((tokens, index) => {
    const variant = variants[index];

    if (variant !== undefined) {
      byCombination.set(combinationKeyOf(tokens), variant.variantId);
    }
  });

  // Duplicate labels would have collapsed two variants onto one key, which means
  // a buyer could pick a combination and be given the other variant's price.
  if (byCombination.size !== variants.length) return undefined;

  return {
    positions: values.map((bucket, index) => ({ index, values: bucket })),
    byCombination,
  };
}
