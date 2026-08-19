import { describe, expect, it } from 'vitest';
import {
  applyPlainTextEdit,
  marksInRange,
  normalizeInlineRuns,
  plainTextOfRuns,
  runsAreUnmarked,
  runsFromPlainText,
  toggleMarkInRange,
  trimInlineRuns,
  type InlineRun,
} from './inline-runs';

const plain = (text: string): InlineRun[] => [{ text }];

describe('normalizeInlineRuns', () => {
  it('merges neighbours carrying the same marks', () => {
    expect(
      normalizeInlineRuns([
        { text: 'He', marks: ['strong'] },
        { text: 'llo', marks: ['strong'] },
        { text: ' there' },
      ]),
    ).toEqual([{ text: 'Hello', marks: ['strong'] }, { text: ' there' }]);
  });

  it('drops empty runs rather than storing them', () => {
    expect(normalizeInlineRuns([{ text: '' }, { text: 'a' }])).toEqual([
      { text: 'a' },
    ]);
  });

  it('omits `marks` entirely for unmarked text', () => {
    const [run] = normalizeInlineRuns([{ text: 'a', marks: [] }]);

    expect(run).toEqual({ text: 'a' });
    expect('marks' in (run ?? {})).toBe(false);
  });

  it('sorts marks into one canonical order, so equal paragraphs checksum equally', () => {
    expect(
      normalizeInlineRuns([{ text: 'a', marks: ['em', 'strong'] }]),
    ).toEqual([{ text: 'a', marks: ['strong', 'em'] }]);
  });
});

describe('trimInlineRuns', () => {
  it('trims the outer edges and leaves interior spacing alone', () => {
    const runs = trimInlineRuns([
      { text: '  Soft ' },
      { text: 'cotton', marks: ['strong'] },
      { text: ' twill  ' },
    ]);

    expect(plainTextOfRuns(runs)).toBe('Soft cotton twill');
  });

  it('drops a run that is entirely outer whitespace', () => {
    expect(
      trimInlineRuns([{ text: '  ' }, { text: 'a', marks: ['em'] }]),
    ).toEqual([{ text: 'a', marks: ['em'] }]);
  });

  /**
   * The reason this function exists. The server trims `text` and compares it to
   * the joined runs, so untrimmed runs would fail the join invariant on any
   * paragraph a seller happened to end with a space.
   */
  it('leaves the join equal to the trimmed plain text', () => {
    const runs = trimInlineRuns([{ text: ' padded ' }]);

    expect(plainTextOfRuns(runs)).toBe(plainTextOfRuns(runs).trim());
  });
});

describe('toggleMarkInRange', () => {
  it('marks exactly the selected range', () => {
    expect(toggleMarkInRange(plain('Soft cotton'), 5, 11, 'strong')).toEqual([
      { text: 'Soft ' },
      { text: 'cotton', marks: ['strong'] },
    ]);
  });

  it('clears the mark when the whole range already carries it', () => {
    const marked = toggleMarkInRange(plain('Soft'), 0, 4, 'strong');

    expect(toggleMarkInRange(marked, 0, 4, 'strong')).toEqual([
      { text: 'Soft' },
    ]);
  });

  it('promotes a partially marked range to fully marked before clearing it', () => {
    const partial: InlineRun[] = [
      { text: 'So', marks: ['strong'] },
      { text: 'ft' },
    ];

    expect(toggleMarkInRange(partial, 0, 4, 'strong')).toEqual([
      { text: 'Soft', marks: ['strong'] },
    ]);
  });

  it('leaves a caret alone — there is no range to emphasise', () => {
    expect(toggleMarkInRange(plain('Soft'), 2, 2, 'strong')).toEqual([
      { text: 'Soft' },
    ]);
  });

  it('combines marks rather than replacing them', () => {
    const bold = toggleMarkInRange(plain('Soft'), 0, 4, 'strong');

    expect(toggleMarkInRange(bold, 0, 4, 'em')).toEqual([
      { text: 'Soft', marks: ['strong', 'em'] },
    ]);
  });

  /**
   * A textarea reports offsets in UTF-16 code units. Splitting a surrogate pair
   * between two runs would leave a lone surrogate in each — a string that
   * validates, renders as a replacement character, and cannot be recovered.
   */
  it('never splits a surrogate pair', () => {
    const runs = toggleMarkInRange(plain('a🧵b'), 0, 2, 'strong');

    expect(plainTextOfRuns(runs)).toBe('a🧵b');
    expect(runs.every((run) => !/[\uD800-\uDBFF]$/.test(run.text))).toBe(true);
    expect(runs.every((run) => !/^[\uDC00-\uDFFF]/.test(run.text))).toBe(true);
  });
});

describe('marksInRange', () => {
  const runs: InlineRun[] = [
    { text: 'Soft ', marks: ['strong'] },
    { text: 'cotton' },
  ];

  it('reports a uniform range as active', () => {
    expect(marksInRange(runs, 0, 5)).toEqual({
      active: ['strong'],
      mixed: [],
    });
  });

  it('reports a half-marked range as mixed, never as unmarked', () => {
    expect(marksInRange(runs, 0, 11)).toEqual({
      active: [],
      mixed: ['strong'],
    });
  });

  it('reports the marks behind a caret, which is what typing will continue', () => {
    expect(marksInRange(runs, 3, 3)).toEqual({
      active: ['strong'],
      mixed: [],
    });
  });
});

describe('applyPlainTextEdit', () => {
  const bold: InlineRun[] = [
    { text: 'Soft', marks: ['strong'] },
    { text: ' cotton' },
  ];

  it('keeps emphasis when typing inside a marked word', () => {
    expect(applyPlainTextEdit(bold, 'Softt cotton')).toEqual([
      { text: 'Softt', marks: ['strong'] },
      { text: ' cotton' },
    ]);
  });

  it('does not extend emphasis into unmarked text after it', () => {
    const next = applyPlainTextEdit(bold, 'Soft cottons');

    expect(next).toEqual([
      { text: 'Soft', marks: ['strong'] },
      { text: ' cottons' },
    ]);
  });

  it('keeps the surrounding marks when a middle section is deleted', () => {
    expect(plainTextOfRuns(applyPlainTextEdit(bold, 'Soft'))).toBe('Soft');
  });

  it('starts plain when text is inserted at the very beginning', () => {
    const next = applyPlainTextEdit(bold, 'Very Soft cotton');

    expect(next[0]).toEqual({ text: 'Very ' });
  });

  it('produces one unmarked run from an empty start', () => {
    expect(applyPlainTextEdit([], 'Hello')).toEqual([{ text: 'Hello' }]);
  });

  it('always leaves the join equal to the edited text', () => {
    const next = applyPlainTextEdit(bold, 'Soft cotton twill, unlined');

    expect(plainTextOfRuns(next)).toBe('Soft cotton twill, unlined');
  });
});

describe('runsAreUnmarked', () => {
  it('is true for plain text, so `runs` can be dropped', () => {
    expect(runsAreUnmarked(runsFromPlainText('Soft'))).toBe(true);
  });

  it('is false once anything is emphasised', () => {
    expect(runsAreUnmarked([{ text: 'Soft', marks: ['em'] }])).toBe(false);
  });
});
