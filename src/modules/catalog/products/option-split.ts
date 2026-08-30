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
 * exactly once, nothing left to infer. A ragged token count or a duplicate label
 * means the label is not a clean encoding, and the seller must map it by hand. A
 * single un-delimited token is *not* a failure — see the width check below.
 *
 * ## A missing combination is not a missing encoding
 *
 * Requiring the cross-product to equal the variant count *exactly* was the
 * original rule, and it refused a shape that is ordinary in apparel: a sparse
 * grid. The live `Three-proof Casual Sports Mountaineering Tactical Pants` sells
 * 52 variants over 8 colour-and-gender values by 8 sizes — 64 combinations, of
 * which 12 do not exist, and systematically so: the four `Male`/`Men` values
 * carry `5XL` and `6XL` and no `M`, the four `Female`/`Women` values carry `M`
 * and stop at `4XL`. Womenswear ending its size run earlier than menswear is not
 * a broken label.
 *
 * Sparsity does not make the split ambiguous. The tokens still come from the
 * supplier's own delimiter, and a hole in the grid is a fact about stock, not a
 * gap that has to be inferred: `byCombination` simply has no entry, and both
 * this module's consumers already read a miss as "that combination cannot be
 * bought". So the exactness test was stricter than anything downstream needed —
 * the storefront's own token-row renderer draws an absent combination as a
 * disabled `Unavailable` chip and always has.
 *
 * ## What replaces it, and why it is not a tuned threshold
 *
 * Pure relaxation would make some products *worse*. Three variants labelled
 * `A-1`, `B-2`, `C-3` describe a 3 × 3 grid holding its diagonal: a buyer would
 * be offered six chips to reach three products, four of them dead. So a sparse
 * grid is proposed only when it is a genuine compression of the flat list —
 * when the chips a buyer scans (the sum of the position sizes) is fewer than one
 * chip per variant.
 *
 * That is the reason the Variant Matrix exists rather than a number chosen to
 * fit: 16 chips instead of 52 is the whole point, and 6 chips instead of 3 is
 * not. A complete grid is unaffected and still proposed on the exactness test
 * alone, so a full 2 × 2 — where the sums are equal — keeps working.
 *
 * ## A position that never varies is dropped, not disqualifying
 *
 * A supplier currently stocking one colour of a garment that comes in five
 * sizes still encodes two positions — `Khaki-M`, `Khaki-L` — one of which is
 * constant *today*. Refusing the whole product over that constant position
 * was the original design and is wrong: it throws away a real, exact `Size`
 * axis because `Colour` happens to have one value right now. The position is
 * dropped from what is offered as an axis — nothing invents a one-choice
 * "Colour" dropdown, which was always the actual concern — and the remaining
 * positions are proposed as before. A product where *every* position is
 * constant cannot reach this branch at all, though no longer for the reason it
 * once could not: every bucket holding one value means every label is the same
 * string, which the duplicate check below refuses before the filter runs. The
 * exactness test used to carry that argument and no longer can, now that a
 * sparse grid is admitted.
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
  /**
   * Variant id per full combination, keyed by its tokens rejoined.
   *
   * **Not every combination of the proposed values has an entry.** A sparse grid
   * is admitted now, so a lookup can miss, and a miss means that combination is
   * not purchasable rather than that something went wrong. `size` is therefore
   * the number of real variants, never the size of the cross-product.
   */
  byCombination: Map<string, string>;
  /**
   * How many positions the supplier's label actually encodes, before constant
   * positions are dropped.
   *
   * `1` means a single-axis product: five colours, no delimiter, nothing
   * concatenated. That is nameable but not the case the publish gate exists for
   * — see `optionMappingRequiredButMissing` in `publish.ts`.
   */
  labelWidth: number;
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
  // One variant is enough, corrected 2026-08-19 by owner decision. The previous
  // floor of two came from "a grid needs two rows", which answered a question
  // nobody was asking: the point of the matrix is not to prove a grid exists but
  // to let a seller say what a buyer reads. A lone variant labelled `Storage box`
  // reached the storefront as the supplier's own words with nothing the seller
  // could do about it, and the section explained that as "Not detected", which
  // sounds like a limitation rather than a rule.
  //
  // Publication is deliberately *not* gated on it — see
  // `optionMappingRequiredButMissing`. A product with one variant offers a buyer
  // no choice to make, so an unnamed axis there is a presentation question, never
  // a correctness one.
  if (variants.length < 1) return undefined;
  // Every variant must carry a label: a partial proposal would silently omit the
  // unlabelled ones.
  if (variants.some((variant) => variant.label === null)) return undefined;

  const tokenised = variants.map((variant) =>
    splitLabelTokens(variant.label ?? ''),
  );
  const width = tokenised[0]?.length ?? 0;

  // An empty label encodes nothing; a ragged set is not an encoding.
  //
  // A width of 1 *is* accepted, corrected 2026-08-18. Refusing it was wrong: a
  // garment sold in five colours and one size arrives as `Black`, `Blue`, ...
  // with no delimiter, which is a complete, exact single-axis grid. The original
  // rationale ("one token carries no structure") confused "cannot be split" with
  // "has no structure" — and a single token is in fact the case with nothing to
  // guess at all, since the whole label is one axis value. The seller still
  // supplies the axis name, exactly as with two positions.
  if (width < 1) return undefined;
  if (tokenised.some((tokens) => tokens.length !== width)) return undefined;

  const values: string[][] = Array.from({ length: width }, () => []);

  tokenised.forEach((tokens) => {
    tokens.forEach((token, index) => {
      const bucket = values[index];

      if (bucket !== undefined && !bucket.includes(token)) bucket.push(token);
    });
  });

  const expected = values.reduce((total, bucket) => total * bucket.length, 1);
  // What a buyer would scan if this were offered as rows of chips: one row per
  // position, one chip per value. Against `variants.length`, which is what the
  // flat fallback costs them — one chip per variant.
  const chipCount = values.reduce((total, bucket) => total + bucket.length, 0);

  // A complete grid passes on exactness alone, exactly as before — including a
  // full 2 x 2, where the two counts are equal and the compression test below
  // would refuse it.
  //
  // A sparse grid passes only when it genuinely compresses. `>=` rather than `>`
  // keeps the break-even case flat: offering the same number of chips while
  // making some of them dead ends is a loss, not a tie.
  if (expected !== variants.length && chipCount >= variants.length) {
    return undefined;
  }

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

  // A position with one value is a constant sitting inside the label, not an
  // axis — offering it as a choice would invent a decision the buyer never
  // has. Dropped here rather than earlier, because the exactness check above
  // must still see every position's contribution to the cross-product; a
  // constant bucket contributes a harmless factor of 1 to that arithmetic.
  const positions = values
    .map((bucket, index) => ({ index, values: bucket }))
    .filter(
      (position) =>
        // With one variant every position holds exactly one value, so the
        // constant rule above would drop all of them and return an empty
        // matrix — worse than the "Not detected" it replaced. The rule exists to
        // stop a buyer being offered a choice that is not a choice; with a single
        // variant there is no choice to fake, and what is left is the seller
        // naming what that one label reads as.
        variants.length === 1 || position.values.length >= 2,
    );

  return { positions, byCombination, labelWidth: width };
}
