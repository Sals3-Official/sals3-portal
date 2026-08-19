/**
 * Emphasis inside one paragraph, as data rather than markup.
 *
 * A rich-text editor normally stores HTML. This one cannot: the description
 * document is an allow list, not a sanitiser, `MARKUP_OPENER` rejects
 * markup-shaped input at the server boundary, and no sanitiser exists
 * anywhere in the system to make stored HTML safe to render. So emphasis is
 * carried as a list of runs — a span of text plus a closed set of marks — and
 * the renderer maps each mark to a real React element. There is nothing for a
 * renderer to interpret, exactly as with the block union itself.
 *
 * The load-bearing rule is in `description-document.ts`: a paragraph's `runs`
 * must join to exactly its `text`. `text` stays the canonical value and
 * `runs` stays optional, which is what lets a reader that knows nothing about
 * marks still render every word. A consumer reading `text` alone loses the
 * emphasis and never loses content — the opposite of the `image` block, which
 * a four-member union drops whole.
 */

/**
 * The complete mark vocabulary.
 *
 * Two entries, and adding a third is a deliberate act: every mark has to be
 * something the storefront can render from a validated enum without a style
 * attribute, so text colour, font size, and highlight are not candidates —
 * those are the parts of a supplier-platform toolbar that only exist because
 * the storage is HTML. `strong` and `em` carry meaning, which is why they
 * survive a plain-text reader as `<strong>`/`<em>` rather than as lost CSS.
 */
export const INLINE_MARKS = ['strong', 'em'] as const;

export type InlineMark = (typeof INLINE_MARKS)[number];

export type InlineRun = {
  text: string;
  /**
   * Absent rather than `[]` for unmarked text. An empty array would be a
   * second way to spell "no emphasis", and two spellings of one fact
   * checksum differently — the same false-edit signal `canonicalize` exists
   * to remove.
   */
  marks?: InlineMark[];
};

/**
 * A ceiling on runs, separate from the text ceiling.
 *
 * `MAX_TEXT_LENGTH` already bounds the characters. This bounds the *structure*
 * over them, because alternating marks every character would produce 4,000
 * objects for 4,000 characters and make a legitimate-looking document
 * expensive to parse, checksum, and render. 200 is far past any real
 * paragraph: the normaliser merges adjacent equal runs, so reaching it needs
 * 200 genuine emphasis changes in one paragraph.
 */
export const MAX_RUNS_PER_BLOCK = 200;

/** Canonical mark order, so two identical paragraphs checksum identically. */
function sortMarks(marks: readonly InlineMark[]): InlineMark[] {
  return INLINE_MARKS.filter((mark) => marks.includes(mark));
}

function sameMarks(
  a: readonly InlineMark[],
  b: readonly InlineMark[],
): boolean {
  return a.length === b.length && a.every((mark, index) => mark === b[index]);
}

export function plainTextOfRuns(runs: readonly InlineRun[]): string {
  return runs.map((run) => run.text).join('');
}

/** The unstyled form: one run, no marks. */
export function runsFromPlainText(text: string): InlineRun[] {
  return text === '' ? [] : [{ text }];
}

/**
 * Collapses runs to their one canonical spelling.
 *
 * Drops empty runs, sorts each mark list, and merges neighbours that carry
 * the same marks. Without the merge, typing inside a bold word would leave a
 * trail of single-character runs that render identically to one run but
 * checksum differently, so every keystroke would look like a structural edit
 * in the revision history.
 */
export function normalizeInlineRuns(runs: readonly InlineRun[]): InlineRun[] {
  return runs
    .filter((run) => run.text !== '')
    .reduce<InlineRun[]>((normalized, run) => {
      const marks = sortMarks(run.marks ?? []);
      const previous = normalized[normalized.length - 1];

      if (previous !== undefined && sameMarks(previous.marks ?? [], marks)) {
        return [
          ...normalized.slice(0, -1),
          { ...previous, text: previous.text + run.text },
        ];
      }

      return [
        ...normalized,
        marks.length === 0 ? { text: run.text } : { text: run.text, marks },
      ];
    }, []);
}

/**
 * Trims the document's outer whitespace without disturbing the inside.
 *
 * The server validates `text` with a trimming schema, so runs that carry
 * leading or trailing whitespace would join to something longer than the
 * stored `text` and fail the join invariant — a save rejected for a reason no
 * seller could act on. Trimming here, on the way out, keeps the two in step.
 * Interior whitespace is untouched: a space between a bold word and the next
 * word is content, and which run owns it is not a fact worth normalising.
 */
export function trimInlineRuns(runs: readonly InlineRun[]): InlineRun[] {
  const trimmed = runs.map((run) => ({ ...run }));

  while (trimmed.length > 0) {
    const first = trimmed[0]!;
    const next = first.text.replace(/^\s+/, '');

    if (next === first.text) break;
    if (next === '') trimmed.shift();
    else {
      first.text = next;
      break;
    }
  }

  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1]!;
    const next = last.text.replace(/\s+$/, '');

    if (next === last.text) break;
    if (next === '') trimmed.pop();
    else {
      last.text = next;
      break;
    }
  }

  return normalizeInlineRuns(trimmed);
}

/**
 * Marks per UTF-16 code unit.
 *
 * Code units rather than code points because every offset this module
 * receives comes from a `<textarea>`'s `selectionStart`/`selectionEnd`, which
 * count code units. Iterating by code point instead — the shape
 * `for (const char of text)` gives — would drift by one for every emoji
 * earlier in the paragraph and apply the mark to the wrong words.
 */
function markSpansOf(runs: readonly InlineRun[]): InlineMark[][] {
  return runs.flatMap((run) => {
    const marks = sortMarks(run.marks ?? []);

    // `.length` rather than spreading the string: spreading iterates code
    // points and would emit one entry per astral character instead of two.
    return Array.from({ length: run.text.length }, () => marks);
  });
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Widens a selection so it can never cut a surrogate pair in half.
 *
 * A browser's own selection respects code points, but a range can still be
 * handed here from a keyboard shortcut or a restored offset. Splitting a pair
 * across two runs with different marks would leave a lone surrogate in each —
 * a string that survives validation, renders as a replacement character, and
 * is unrecoverable once stored.
 */
function snapRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let safeStart = Math.max(0, Math.min(start, text.length));
  let safeEnd = Math.max(safeStart, Math.min(end, text.length));

  if (safeStart > 0 && isLowSurrogate(text.charCodeAt(safeStart)))
    safeStart -= 1;
  if (
    safeEnd > 0 &&
    safeEnd < text.length &&
    isHighSurrogate(text.charCodeAt(safeEnd - 1))
  ) {
    safeEnd += 1;
  }

  return { start: safeStart, end: safeEnd };
}

function runsFromSpans(
  text: string,
  spans: readonly InlineMark[][],
): InlineRun[] {
  return normalizeInlineRuns(
    Array.from({ length: text.length }, (_, index) => ({
      text: text.charAt(index),
      marks: spans[index] ?? [],
    })),
  );
}

export type MarkState = {
  /** Carried by every code unit in the range. The toolbar shows these pressed. */
  active: InlineMark[];
  /** Carried by some but not all of it. The toolbar shows these indeterminate. */
  mixed: InlineMark[];
};

/**
 * What the toolbar should show for the current selection.
 *
 * `mixed` exists so a half-bold selection does not render as "not bold": a
 * pressed-or-not button would tell the seller the range is uniform when it is
 * not, and the next press would then look like it did the opposite of what it
 * did.
 */
export function marksInRange(
  runs: readonly InlineRun[],
  start: number,
  end: number,
): MarkState {
  const text = plainTextOfRuns(runs);
  const range = snapRange(text, start, end);
  const spans = markSpansOf(runs).slice(range.start, range.end);

  if (spans.length === 0) {
    // A caret, not a selection. Report the marks immediately behind it, which
    // is what a seller expects typing to continue.
    const behind = markSpansOf(runs)[Math.max(0, range.start - 1)] ?? [];

    return { active: sortMarks(behind), mixed: [] };
  }

  const counts = INLINE_MARKS.map((mark) => ({
    mark,
    count: spans.filter((marks) => marks.includes(mark)).length,
  }));

  return {
    active: counts
      .filter((entry) => entry.count === spans.length)
      .map((entry) => entry.mark),
    mixed: counts
      .filter((entry) => entry.count > 0 && entry.count < spans.length)
      .map((entry) => entry.mark),
  };
}

/**
 * Adds a mark to the range, or clears it when the whole range already has it.
 *
 * All-or-nothing rather than per-run: a partially bold selection becomes fully
 * bold on the first press and plain on the second. The alternative — flipping
 * each character independently — inverts a mixed selection into a different
 * mixed selection, which is unpredictable and impossible to undo by pressing
 * again.
 */
export function toggleMarkInRange(
  runs: readonly InlineRun[],
  start: number,
  end: number,
  mark: InlineMark,
): InlineRun[] {
  const text = plainTextOfRuns(runs);
  const range = snapRange(text, start, end);

  if (range.start === range.end) return normalizeInlineRuns(runs);

  const spans = markSpansOf(runs);
  const selected = spans.slice(range.start, range.end);
  const shouldClear = selected.every((marks) => marks.includes(mark));

  const next = spans.map((marks, index) => {
    if (index < range.start || index >= range.end) return marks;

    if (shouldClear) return marks.filter((entry) => entry !== mark);

    return marks.includes(mark) ? marks : sortMarks([...marks, mark]);
  });

  return runsFromSpans(text, next);
}

/**
 * Replays a plain-text edit onto marked runs, keeping the marks either side.
 *
 * The editor's text surface is a `<textarea>`, so what comes back from an edit
 * is a whole new string with no idea which parts moved. Diffing it by common
 * prefix and suffix means typing inside a bold word stays bold and typing
 * after it does not become bold, without the editor having to model
 * keystrokes. A paste that replaces a marked range takes the marks of the
 * text it replaced, which is the same rule every text editor uses.
 */
export function applyPlainTextEdit(
  runs: readonly InlineRun[],
  nextText: string,
): InlineRun[] {
  const previousText = plainTextOfRuns(runs);

  if (nextText === previousText) return normalizeInlineRuns(runs);
  if (previousText === '') return runsFromPlainText(nextText);

  let prefix = 0;

  while (
    prefix < previousText.length &&
    prefix < nextText.length &&
    previousText[prefix] === nextText[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < previousText.length - prefix &&
    suffix < nextText.length - prefix &&
    previousText[previousText.length - 1 - suffix] ===
      nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const spans = markSpansOf(runs);
  const insertedLength = nextText.length - prefix - suffix;
  // Marks for inserted text come from the code unit before the insertion
  // point, so continuing a bold word keeps it bold. At offset 0 there is
  // nothing behind the caret, so new leading text is plain.
  const inheritedMarks = prefix > 0 ? (spans[prefix - 1] ?? []) : [];

  const nextSpans: InlineMark[][] = [
    ...spans.slice(0, prefix),
    ...Array.from(
      { length: Math.max(0, insertedLength) },
      () => inheritedMarks,
    ),
    ...spans.slice(previousText.length - suffix),
  ];

  return runsFromSpans(nextText, nextSpans);
}

/** True when the runs carry no emphasis, so `runs` can be omitted entirely. */
export function runsAreUnmarked(runs: readonly InlineRun[]): boolean {
  return runs.every((run) => (run.marks ?? []).length === 0);
}
