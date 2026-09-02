// @vitest-environment node
import { describe, expect, it } from 'vitest';
import checkDescriptionCopy, {
  canonSize,
  looksLikeASize,
  sizeClaimsNotOnSale,
  sizesOnSale,
} from './description-copy-guard';
import type { DescriptionBlock } from './description-document';

/**
 * The copy rules, ported from the automation client's `description_guard`.
 * Every problem case reached a live page while these ran client-side: the
 * vanished lead paragraph (49 products), the CJ citation live for a week,
 * and "sizes M through 4XL" on a picker selling XS-3XL.
 */

const PARAGRAPH = (text: string): DescriptionBlock => ({
  type: 'paragraph',
  text,
});
const HEADING = (text: string): DescriptionBlock => ({
  type: 'heading',
  level: 2,
  text,
});

const GOOD_LEAD = PARAGRAPH(
  'Straight-cut work trousers in a mid-weight cotton twill, with a zip fly and deep front pockets.',
);

describe('canonSize / looksLikeASize', () => {
  it('XXL and 2XL are one size in two spellings', () => {
    expect(canonSize('XXL')).toBe('2XL');
    expect(canonSize('2XL')).toBe('2XL');
    expect(canonSize('XXXL')).toBe('3XL');
  });

  it('sizes are sizes and colours are not', () => {
    expect(looksLikeASize('2XL')).toBe(true);
    expect(looksLikeASize('32')).toBe(true);
    expect(looksLikeASize('Army Green')).toBe(false);
    expect(looksLikeASize('919black')).toBe(false);
  });
});

describe('sizesOnSale', () => {
  it('reads raw supplier labels and mapped labels alike - two spellings, one value', () => {
    expect(sizesOnSale(['Blue A-2XL', 'Blue A-M'])).toEqual(['2XL', 'M']);
    expect(sizesOnSale(['Colour: Blue, Size: XXL'])).toEqual(['XXL']);
  });

  it('deduplicates across spellings and skips absent labels', () => {
    expect(sizesOnSale(['Black-XXL', 'White-2XL', null])).toEqual(['XXL']);
  });
});

describe('sizeClaimsNotOnSale', () => {
  it('flags a claimed size the picker does not sell - the M-through-4XL error', () => {
    const problems = sizeClaimsNotOnSale(
      [PARAGRAPH('Available in sizes M through 4XL.')],
      ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
    );

    expect(problems).toEqual([
      'the copy claims size 4XL but the picker does not sell it',
    ]);
  });

  it('a sold size the prose does not mention is normal writing, and XXL covers 2XL', () => {
    expect(
      sizeClaimsNotOnSale(
        [PARAGRAPH('Runs from S to XXL.')],
        ['S', 'M', '2XL'],
      ),
    ).toEqual([]);
  });

  it('checks nothing when the caller knows no sizes - absence of a picker is not evidence', () => {
    expect(sizeClaimsNotOnSale([PARAGRAPH('Sizes M to 4XL.')], [])).toEqual([]);
  });

  it('never reads a table as prose - a chart legitimately names its own sizes', () => {
    const chart: DescriptionBlock = {
      type: 'table',
      headers: ['Size', 'Waist (cm)'],
      rows: [['4XL', '98']],
    };

    expect(sizeClaimsNotOnSale([GOOD_LEAD, chart], ['M'])).toEqual([]);
  });
});

describe('checkDescriptionCopy', () => {
  it('refuses an empty document - clearing a live description is not an edit', () => {
    const verdict = checkDescriptionCopy([], []);

    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain('empty');
  });

  it('refuses a heading lead block - the storefront renders block 0 under the title', () => {
    const verdict = checkDescriptionCopy(
      [HEADING('How it fits'), GOOD_LEAD],
      [],
    );

    expect(verdict.problems[0]).toContain('not a paragraph');
  });

  it('refuses supplier citations and logistics copy by name', () => {
    const verdict = checkDescriptionCopy(
      [
        GOOD_LEAD,
        PARAGRAPH('CJ lists denim with cotton as the main fabric composition.'),
        PARAGRAPH('Fast shipping and easy returns on every order.'),
      ],
      [],
    );

    expect(
      verdict.problems.some((problem) => problem.includes('cj lists')),
    ).toBe(true);
    expect(
      verdict.problems.some((problem) => problem.includes('shipping')),
    ).toBe(true);
  });

  it('passes clean copy, and reports answer-engine shape as warnings only', () => {
    const verdict = checkDescriptionCopy(
      [GOOD_LEAD, HEADING('Details'), PARAGRAPH('A pocket for everything.')],
      ['M', 'L'],
    );

    expect(verdict.problems).toEqual([]);
    expect(
      verdict.warnings.some((warning) => warning.includes("'Details'")),
    ).toBe(true);
  });

  it('reads bullet items and key-value entries as prose', () => {
    const verdict = checkDescriptionCopy(
      [
        GOOD_LEAD,
        { type: 'bulletList', items: ['Tracked delivery worldwide'] },
      ],
      [],
    );

    expect(
      verdict.problems.some((problem) => problem.includes('delivery')),
    ).toBe(true);
  });
});
