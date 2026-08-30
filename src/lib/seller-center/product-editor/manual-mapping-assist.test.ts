import { describe, expect, it } from 'vitest';
import {
  assignmentsFromMappedAxes,
  countUnassigned,
  matchAxisValue,
  parseAxisValues,
  suggestAssignments,
} from './manual-mapping-assist';

describe('parseAxisValues', () => {
  it('accepts one value per line and comma-separated alike', () => {
    expect(parseAxisValues('Black\nGray\nKhaki')).toEqual([
      'Black',
      'Gray',
      'Khaki',
    ]);
    expect(parseAxisValues('Black, Gray , Khaki')).toEqual([
      'Black',
      'Gray',
      'Khaki',
    ]);
  });

  it('drops blanks and case-insensitive repeats rather than letting the save fail', () => {
    // `product_option_values_option_normalized_key` cannot hold `Black` twice, so
    // refusing the save over a value typed twice by accident would be a worse
    // answer than accepting the one that was meant.
    expect(parseAxisValues('Black\n\nblack\n  \nGray,')).toEqual([
      'Black',
      'Gray',
    ]);
  });

  it('keeps a multi-word value whole', () => {
    expect(parseAxisValues('Light Brown\nArmy Green')).toEqual([
      'Light Brown',
      'Army Green',
    ]);
  });
});

describe('matchAxisValue', () => {
  it('tests the longest candidate first, so Women beats the Men inside it', () => {
    // The correctness argument for the ordering: `Black Women` contains `Men`.
    expect(matchAxisValue('Black Women-XL', ['Men', 'Women'])).toBe('Women');
    expect(matchAxisValue('Black Men-XL', ['Men', 'Women'])).toBe('Men');
  });

  it('matches regardless of case', () => {
    expect(matchAxisValue('BLACK MEN-XL', ['Black'])).toBe('Black');
  });

  it('answers undefined rather than guessing when nothing matches', () => {
    expect(matchAxisValue('Khaki Male-XL', ['Black', 'Gray'])).toBe(undefined);
  });
});

/**
 * The real tactical-pants labels. The supplier spells gender four ways across one
 * product — `Male`, `Men`, `Female`, `Women` — with the word order reversed on
 * `Female, Gray`, which is precisely why the final say is a person's.
 */
const PANTS = [
  { variantId: 'v1', label: 'Black Men-L' },
  { variantId: 'v2', label: 'Gray Male-XL' },
  { variantId: 'v3', label: 'Black Female-L' },
  { variantId: 'v4', label: 'Female, Gray-XL' },
];

describe('suggestAssignments', () => {
  it('fills what the labels plainly say', () => {
    const suggestions = suggestAssignments(PANTS, [
      { values: ['Black', 'Gray'] },
      { values: ['L', 'XL'] },
    ]);

    expect(suggestions.v1).toEqual(['Black', 'L']);
    expect(suggestions.v2).toEqual(['Gray', 'XL']);
    expect(suggestions.v3).toEqual(['Black', 'L']);
    expect(suggestions.v4).toEqual(['Gray', 'XL']);
  });

  it('leaves a gap where the supplier used a different word, instead of guessing', () => {
    const suggestions = suggestAssignments(PANTS, [
      { values: ['Men', 'Women'] },
    ]);

    // `Black Men` and `Black Female` are found. `Gray Male` and `Female, Gray`
    // are not, because the supplier said Male and Female on those rows — a gap
    // the seller closes with one dropdown, rather than a wrong attribute on a
    // live listing.
    expect(suggestions.v1).toEqual(['Men']);
    expect(suggestions.v2).toEqual([undefined]);
    expect(suggestions.v3).toEqual([undefined]);
    expect(suggestions.v4).toEqual([undefined]);
  });

  it('never invents a value that is not in the axis', () => {
    const suggestions = suggestAssignments(PANTS, [{ values: ['Khaki'] }]);

    expect(Object.values(suggestions).flat()).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('countUnassigned', () => {
  it('counts every empty cell, not every incomplete row', () => {
    // Two axes across four variants is eight cells; the seller needs to know how
    // many decisions are left, not how many rows are touched.
    const assignments = {
      v1: ['Black', 'L'],
      v2: ['Gray', undefined],
      v3: [undefined, undefined],
    };

    expect(countUnassigned(PANTS, assignments, 2)).toBe(5);
  });

  it('treats a whitespace-only value as unassigned', () => {
    expect(countUnassigned([{ variantId: 'v1' }], { v1: ['  '] }, 1)).toBe(1);
  });

  it('is zero when every cell is filled', () => {
    expect(
      countUnassigned(
        [{ variantId: 'v1' }, { variantId: 'v2' }],
        { v1: ['Black'], v2: ['Gray'] },
        1,
      ),
    ).toBe(0);
  });
});

describe('assignmentsFromMappedAxes', () => {
  const AXES = [
    {
      values: [
        { label: 'Black', variantIds: ['v1', 'v2'] },
        { label: 'Gray', variantIds: ['v3'] },
      ],
    },
    {
      values: [
        { label: 'L', variantIds: ['v1', 'v3'] },
        { label: 'XL', variantIds: ['v2'] },
      ],
    },
  ];

  it('inverts the stored value-to-variant links into one row per variant', () => {
    // `variantIds` exists so a value's photo can be found. It is the assignment
    // already, inverted — so pre-filling the editor needs no new query.
    expect(assignmentsFromMappedAxes(['v1', 'v2', 'v3'], AXES)).toEqual({
      v1: ['Black', 'L'],
      v2: ['Black', 'XL'],
      v3: ['Gray', 'L'],
    });
  });

  it('leaves a cell empty rather than guessing when no value claims the variant', () => {
    // The illustrative fixtures carry no stored links at all, and a mapping that
    // somehow missed a variant must not be filled in on its behalf.
    expect(assignmentsFromMappedAxes(['v9'], AXES)).toEqual({
      v9: [undefined, undefined],
    });
  });
});
