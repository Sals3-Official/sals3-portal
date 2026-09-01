// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { firstAxisValueOf, planAssignments } from './variant-media-source-plan';

/**
 * The planning rules of the last browser write moved server-side. Every
 * refusal here is a rule the browser tool already proved on live products -
 * assigning MOVES a photo, so a wrong write un-does a right one.
 */

const MEDIA = (
  code: string,
  variantId: string | null = null,
  sourceType = 'SUPPLIER_ORIGINAL',
) => ({
  mediaId: `media-${code.slice(0, 4)}`,
  url: `https://cf.cjdropshipping.com/${code}.jpg?x-oss-process=image/resize,w_120/format,webp`,
  sourceType,
  variantId,
});

const CODE_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const CODE_B = 'bbbbbbbb-2222-4222-8222-222222222222';

describe('firstAxisValueOf', () => {
  it('reads both label shapes, because reading one is this toolkit’s most-repeated defect', () => {
    // Raw supplier label, split on the FIRST dash: Blue A-2XL is `Blue A`.
    expect(firstAxisValueOf('919black-2XL')).toBe('919black');
    expect(firstAxisValueOf('Blue A-2XL')).toBe('Blue A');
    // The editor's formatted label, after mapping.
    expect(firstAxisValueOf('Colour: 919black, Size: 2XL')).toBe('919black');
    expect(firstAxisValueOf('Size: M')).toBe('M');
  });
});

describe('planAssignments', () => {
  const variants = [
    { id: 'v-1', optionLabel: 'Colour: Green, Size: S' },
    { id: 'v-2', optionLabel: 'Colour: Green, Size: M' },
    { id: 'v-3', optionLabel: 'Colour: Khaki, Size: S' },
  ];

  it('plans one write per first-axis value, on its FIRST variant', () => {
    const plan = planAssignments(
      variants,
      [MEDIA(CODE_A), MEDIA(CODE_B)],
      [
        { firstAxisValue: 'Green', sourceCode: CODE_A },
        { firstAxisValue: 'Khaki', sourceCode: CODE_B },
      ],
    );

    expect(plan.refused).toBeNull();
    expect(plan.writes).toEqual([
      { firstAxisValue: 'Green', mediaId: 'media-aaaa', variantId: 'v-1' },
      { firstAxisValue: 'Khaki', mediaId: 'media-bbbb', variantId: 'v-3' },
    ]);
  });

  it('refuses the WHOLE plan when two values share one code', () => {
    // `map_collisions`: assigning moves a photo, so the second write undoes
    // the first and both read back as done.
    const plan = planAssignments(
      variants,
      [MEDIA(CODE_A)],
      [
        { firstAxisValue: 'Green', sourceCode: CODE_A },
        { firstAxisValue: 'Khaki', sourceCode: CODE_A },
      ],
    );

    expect(plan.refused).not.toBeNull();
    expect(plan.writes).toEqual([]);
  });

  it('never steals a photo already pointed at another variant', () => {
    const plan = planAssignments(
      variants,
      [MEDIA(CODE_A, 'v-9')],
      [{ firstAxisValue: 'Green', sourceCode: CODE_A }],
    );

    expect(plan.writes).toEqual([]);
    expect(plan.outcomes[0]?.outcome).toBe('refused');
    expect(plan.outcomes[0]?.reason).toContain('refusing to move it');
  });

  it('is idempotent: the right variant already holding the photo is not a failure', () => {
    const plan = planAssignments(
      variants,
      [MEDIA(CODE_A, 'v-1')],
      [{ firstAxisValue: 'Green', sourceCode: CODE_A }],
    );

    expect(plan.writes).toEqual([]);
    expect(plan.outcomes[0]?.outcome).toBe('already_done');
  });

  it('refuses a code no stored photo carries, by name, and plans the rest', () => {
    const plan = planAssignments(
      variants,
      [MEDIA(CODE_A)],
      [
        { firstAxisValue: 'Green', sourceCode: CODE_A },
        { firstAxisValue: 'Khaki', sourceCode: CODE_B },
      ],
    );

    expect(plan.writes).toHaveLength(1);
    expect(plan.outcomes[0]?.firstAxisValue).toBe('Khaki');
    expect(plan.outcomes[0]?.reason).toContain('no stored photo');
  });

  it('refuses an ambiguous code rather than guessing between two photos', () => {
    const twin = { ...MEDIA(CODE_A), mediaId: 'media-twin' };
    const plan = planAssignments(
      variants,
      [MEDIA(CODE_A), twin],
      [{ firstAxisValue: 'Green', sourceCode: CODE_A }],
    );

    expect(plan.writes).toEqual([]);
    expect(plan.outcomes[0]?.reason).toContain('ambiguous');
  });

  it('only ever plans against SUPPLIER_ORIGINAL rows', () => {
    // A seller upload carrying a CJ-looking address must not be moved by a
    // CJ-code plan - it is the seller's own photo.
    const plan = planAssignments(
      variants,
      [MEDIA(CODE_A, null, 'SELLER_UPLOAD')],
      [{ firstAxisValue: 'Green', sourceCode: CODE_A }],
    );

    expect(plan.writes).toEqual([]);
    expect(plan.outcomes[0]?.reason).toContain('no stored photo');
  });
});
