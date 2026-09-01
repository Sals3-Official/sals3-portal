/**
 * The pure planning half of `assign-variant-media-by-source.ts`, in its own
 * module so the refusal rules are testable without the server import graph -
 * `read-model.ts` pulls `server-only`, which refuses to load in a test file,
 * and rules that cannot be tested are how this project shipped four
 * correct-but-uncalled guards. See the orchestrating module for why each
 * refusal exists.
 */

/** One first-axis value's photo, addressed by CJ's own image code. */
export type SourceCodeAssignment = {
  /** e.g. `919black` - the first-axis value as the variant labels spell it. */
  firstAxisValue: string;
  /** The UUID in the CJ image address, e.g. `3a9863e9-8288-...`. */
  sourceCode: string;
};

export type SourceCodeOutcome = {
  firstAxisValue: string;
  outcome: 'assigned' | 'already_done' | 'refused';
  mediaId: string | null;
  variantId: string | null;
  /** Why, when refused. In the operator's terms, never a Postgres string. */
  reason: string | null;
};

export type AssignBySourceResult =
  | { ok: true; outcomes: SourceCodeOutcome[]; assigned: number }
  | { ok: false; reason: 'not_found' | 'plan_refused'; detail?: string };

/**
 * The first-axis token of a variant label, in either shape the editor
 * renders: `919black-2XL` before mapping (split on the FIRST dash - `Blue
 * A-2XL` is the colour `Blue A`), `Colour: 919black, Size: 2XL` after.
 * Reading only one shape is this toolkit's most-repeated defect, so both
 * are handled and tested.
 */
export function firstAxisValueOf(optionLabel: string): string {
  const label = optionLabel.trim();

  if (label.includes(':')) {
    const firstPair = label.split(',', 1)[0] ?? '';

    return (firstPair.split(':', 2)[1] ?? '').trim();
  }

  const dash = label.indexOf('-');

  return (dash === -1 ? label : label.slice(0, dash)).trim();
}

type VariantRow = { id: string; optionLabel: string };
type MediaRow = {
  mediaId: string;
  url: string;
  sourceType: string;
  variantId: string | null;
};

export type PlannedWrite = {
  firstAxisValue: string;
  mediaId: string;
  variantId: string;
};

export type Plan = {
  writes: PlannedWrite[];
  outcomes: SourceCodeOutcome[];
  /** Set when the whole plan is refused; nothing may be written. */
  refused: string | null;
};

/** Pure and exported so the refusal rules are testable without a database. */
export function planAssignments(
  variants: VariantRow[],
  assignableMedia: MediaRow[],
  wanted: SourceCodeAssignment[],
): Plan {
  const codes = wanted.map((entry) => entry.sourceCode);

  if (new Set(codes).size !== codes.length) {
    return {
      writes: [],
      outcomes: [],
      refused:
        'two first-axis values share one CJ image code - the capture cannot tell them apart, so nothing was written',
    };
  }

  const supplierRows = assignableMedia.filter(
    (row) => row.sourceType === 'SUPPLIER_ORIGINAL',
  );

  const variantOf = new Map<string, string>();

  variants.forEach((variant) => {
    const value = firstAxisValueOf(variant.optionLabel);

    if (value !== '' && !variantOf.has(value)) {
      variantOf.set(value, variant.id);
    }
  });

  /** One entry's fate, decided without touching the others. */
  const decide = ({
    firstAxisValue,
    sourceCode,
  }: SourceCodeAssignment): PlannedWrite | SourceCodeOutcome => {
    const refusal = (reason: string): SourceCodeOutcome => ({
      firstAxisValue,
      outcome: 'refused',
      mediaId: null,
      variantId: null,
      reason,
    });

    const matches = supplierRows.filter((row) => row.url.includes(sourceCode));

    if (matches.length === 0) {
      return refusal(
        `no stored photo carries CJ code ${sourceCode.slice(0, 8)} - it may not have mirrored onto this product`,
      );
    }

    if (matches.length > 1) {
      return refusal(
        `${matches.length} stored photos carry CJ code ${sourceCode.slice(0, 8)} - ambiguous, refused rather than guessed`,
      );
    }

    const media = matches[0];
    const variantId = variantOf.get(firstAxisValue);

    if (media === undefined || variantId === undefined) {
      return refusal('no variant carries this first-axis value');
    }

    if (media.variantId === variantId) {
      return {
        firstAxisValue,
        outcome: 'already_done',
        mediaId: media.mediaId,
        variantId,
        reason: null,
      };
    }

    if (media.variantId !== null) {
      return refusal(
        `photo ${media.mediaId.slice(0, 8)} already points at another variant - refusing to move it`,
      );
    }

    return { firstAxisValue, mediaId: media.mediaId, variantId };
  };

  const decided = wanted.map(decide);
  const isWrite = (
    entry: PlannedWrite | SourceCodeOutcome,
  ): entry is PlannedWrite => !('outcome' in entry);

  return {
    writes: decided.filter(isWrite),
    outcomes: decided.filter(
      (entry): entry is SourceCodeOutcome => !isWrite(entry),
    ),
    refused: null,
  };
}
