// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  derivePlusSize,
  materialFromProperties,
  matchOption,
  signalMatches,
  suggestAttributes,
  type AttributeField,
} from './suggest-attributes-rules';

/**
 * The attribute-decision rules, ported from the automation client. Each
 * regression case here is a FALSE CLAIM that reached (or nearly reached) a
 * live page while these rules ran client-side - the negation guard, the
 * clause boundary, the Brand alias, the sportswear filler word.
 */

const FIELD = (
  attributeName: string,
  allowedValues: string[],
  overrides: Partial<AttributeField> = {},
): AttributeField => ({
  attributeName,
  requirement: 'REQUIRED',
  allowedValues,
  values: [],
  ...overrides,
});

describe('matchOption', () => {
  it('returns the option as the list spells it', () => {
    expect(matchOption(['Cargo Pants', 'Jeans / Denim'], 'cargo pants')).toBe(
      'Cargo Pants',
    );
  });

  it('bridges the Generic/UNBRANDED alias in both directions - Brand stayed blank on three live products without this', () => {
    expect(matchOption(['UNBRANDED', 'NIKE'], 'Generic')).toBe('UNBRANDED');
    expect(matchOption(['Generic', 'Nike'], 'unbranded')).toBe('Generic');
  });

  it('returns null rather than a near miss', () => {
    expect(matchOption(['Cargo Pants'], 'Cargo')).toBeNull();
  });
});

describe('signalMatches', () => {
  it('finds a plain signal', () => {
    expect(signalMatches(['stretch cargo joggers'], 'cargo')).toBe(true);
  });

  it('suppresses a negated signal - the "No belt" property value nearly published Buckle Belted', () => {
    // Clauses are property VALUES, one per fact - the label never joins the
    // clause, so "no " sits inside the negation window of the signal.
    expect(signalMatches(['no belt'], 'belt')).toBe(false);
  });

  it('a negation in one clause cannot reach a genuine signal in the next', () => {
    expect(signalMatches(['no belt', 'cargo pants'], 'cargo')).toBe(true);
  });

  it('a later un-negated occurrence in the same clause still matches', () => {
    expect(
      signalMatches(['no belt included, but a belted waist design'], 'belted'),
    ).toBe(true);
  });
});

describe('derivePlusSize', () => {
  it('reads Yes off an extended run and No off a regular one', () => {
    expect(derivePlusSize(['Black-2XL', 'Black-M'])).toBe('Yes');
    expect(derivePlusSize(['Black-XXL'])).toBe('Yes');
    expect(derivePlusSize(['Black-M', 'Black-XL'])).toBe('No');
  });

  it('answers nothing when there are no labels to read', () => {
    expect(derivePlusSize([])).toBeNull();
    expect(derivePlusSize([''])).toBeNull();
  });
});

describe('materialFromProperties', () => {
  const OPTIONS = ['Cotton', 'Denim', 'Polyester'];

  it('reads the supplier property table', () => {
    expect(
      materialFromProperties(
        [{ label: 'Material', value: 'Cotton' }],
        OPTIONS,
        'Casual Trousers',
      ),
    ).toBe('Cotton');
  });

  it('prefers Denim on jeans even when the supplier writes Cotton - denim IS cotton', () => {
    expect(
      materialFromProperties(
        [{ label: 'Main Fabric Composition', value: '100% cotton' }],
        OPTIONS,
        'Ripped Stretch Jeans',
      ),
    ).toBe('Denim');
  });

  it('never invents a material when the supplier states none', () => {
    expect(
      materialFromProperties(
        [{ label: 'Style', value: 'Casual' }],
        OPTIONS,
        'Jeans',
      ),
    ).toBeNull();
  });
});

describe('suggestAttributes', () => {
  const PANTS_TYPE = FIELD('Pants Type', [
    'Cargo Pants',
    'Jeans / Denim',
    'Wide-Leg Pants',
  ]);
  const PANTS_FIT = FIELD('Pants Fit', [
    'Cargo Relaxed',
    'Regular / Straight Leg',
    'Wide Leg',
  ]);
  const BRAND = FIELD('Brand', ['UNBRANDED', 'Nike']);
  const STYLE = FIELD('Style', ['Casual', 'Athletic', 'Street Style']);

  it('decides policy fields, cascades a photo answer, and leaves Pants Type pending when nothing fires', () => {
    const result = suggestAttributes({
      title: 'Loose Straight Casual Trousers',
      fields: [PANTS_TYPE, PANTS_FIT, BRAND],
      variantLabels: ['Black-M', 'Black-L'],
      supplierProperties: [],
      known: {},
    });

    expect(result.decided.Brand).toEqual(['UNBRANDED']);
    // No Pants Type default, by design: a wrong garment name is a false
    // statement, so the field waits for a photograph.
    expect(result.decided['Pants Type']).toBeUndefined();
    expect(result.pending.map((field) => field.name)).toContain('Pants Type');
  });

  it('a photograph answer outranks the rules and cascades - Cargo Pants makes the fit Cargo Relaxed', () => {
    const result = suggestAttributes({
      title: 'Casual Trousers',
      fields: [PANTS_TYPE, PANTS_FIT],
      variantLabels: [],
      supplierProperties: [],
      known: { 'Pants Type': 'Cargo Pants' },
    });

    expect(result.decided['Pants Type']).toEqual(['Cargo Pants']);
    expect(result.decided['Pants Fit']).toEqual(['Cargo Relaxed']);
  });

  it('a supplier negation cannot fire a signal, and a filled field is never re-decided', () => {
    const result = suggestAttributes({
      title: 'Straight Trousers',
      fields: [
        FIELD('Fly Type', ['Buckle Belted', 'Zipper Fly & Button']),
        FIELD('Style', ['Casual', 'Athletic'], { values: ['Athletic'] }),
      ],
      variantLabels: [],
      supplierProperties: [{ label: 'Is there a belt', value: 'No belt' }],
      known: {},
    });

    expect(result.decided['Fly Type']).toEqual(['Zipper Fly & Button']);
    expect(result.decided.Style).toBeUndefined();
  });

  it('"Sports All-match" filler does not make a casual garment Athletic - only "sportswear" does', () => {
    const filler = suggestAttributes({
      title: 'Sports All-match Casual Trousers',
      fields: [STYLE],
      variantLabels: [],
      supplierProperties: [],
      known: {},
    });
    const genuine = suggestAttributes({
      title: 'Mens Sportswear Joggers',
      fields: [STYLE],
      variantLabels: [],
      supplierProperties: [],
      known: {},
    });

    expect(filler.decided.Style).toEqual(['Casual']);
    expect(genuine.decided.Style).toEqual(['Athletic']);
  });

  it('every decision carries an audit note naming its source', () => {
    const result = suggestAttributes({
      title: 'Wide-Leg Trousers',
      fields: [PANTS_TYPE, BRAND],
      variantLabels: [],
      supplierProperties: [],
      known: {},
    });

    expect(result.notes).toContain(
      'Pants Type=Wide-Leg Pants (signal: wide-leg)',
    );
    expect(result.notes).toContain('Brand=UNBRANDED (policy)');
  });
});
