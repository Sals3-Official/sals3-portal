// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// `variation-families.ts` is `server-only`, which throws on import outside a
// Server Component — it carries a ~429KB extract that must never reach a
// browser bundle. The guard is doing its job; these are pure functions inside
// that module, so this test stands the guard down rather than weakening it.
// Same convention as `read-model.editor-projection.test.ts`.
vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import variationFamiliesExtract from '@/lib/db/seed-data/sals3-category-variation-families-v1.json';
import {
  FAMILY_AXIS_NAMES,
  axisNameForFamilies,
  suggestedAxisNamesForCategory,
} from './variation-families';
/* eslint-enable import/first */

/**
 * These assertions are about a *suggestion*, so the interesting cases are the
 * refusals: an unknown family, an uncovered category, a tier the workbook left
 * blank. Each must yield `null` rather than an invented label, because the value
 * is offered to a seller as a buyer-facing option name.
 */
describe('axisNameForFamilies', () => {
  it('maps a single family token to its buyer-facing name', () => {
    expect(axisNameForFamilies(['COLOR'])).toBe('Colour');
    expect(axisNameForFamilies(['SIZE'])).toBe('Size');
  });

  it('takes the first token when the workbook lists several for one tier', () => {
    // The sheet orders these by primacy; a joined "Colour / Material" would
    // recreate the verbose-label problem this module exists to remove.
    expect(axisNameForFamilies(['COLOR', 'MATERIAL'])).toBe('Colour');
    expect(axisNameForFamilies(['MODEL_SPEC', 'BUNDLE'])).toBe('Model');
  });

  it('suggests nothing for an empty or unrecognized family cell', () => {
    expect(axisNameForFamilies([])).toBeNull();
    expect(axisNameForFamilies(['NOT_A_FAMILY'])).toBeNull();
  });

  it('skips an unknown token rather than giving up on the cell', () => {
    expect(axisNameForFamilies(['NOT_A_FAMILY', 'SIZE'])).toBe('Size');
  });
});

describe('suggestedAxisNamesForCategory', () => {
  it('returns tier 1 then tier 2 for a covered category', () => {
    // CAT-GGL-1057 is a COLOR / SIZE category in the committed extract.
    expect(suggestedAxisNamesForCategory('CAT-GGL-1057')).toEqual([
      'Colour',
      'Size',
    ]);
  });

  it('returns no suggestions at all for an unknown or absent category', () => {
    expect(suggestedAxisNamesForCategory(null)).toEqual([]);
    expect(suggestedAxisNamesForCategory('CJ-1042')).toEqual([]);
    expect(suggestedAxisNamesForCategory('CAT-GGL-does-not-exist')).toEqual([]);
  });

  it('keeps positional alignment by returning null for a tier with no family', () => {
    const patternsByCode = new Map(
      variationFamiliesExtract.patterns.map((pattern) => [
        pattern.patternCode,
        pattern,
      ]),
    );
    const sizeless = variationFamiliesExtract.categories.find((assignment) => {
      const pattern = patternsByCode.get(assignment.patternCode);

      return pattern !== undefined && pattern.tier2Families.length === 0;
    });

    expect(sizeless).toBeDefined();

    const names = suggestedAxisNamesForCategory(sizeless?.code ?? null);

    // Length 2, not 1: index 1 must still mean "tier 2" to the caller.
    expect(names).toHaveLength(2);
    expect(names[1]).toBeNull();
  });
});

describe('the committed extract', () => {
  it('carries every family token the axis-name map knows, and no others', () => {
    expect([...variationFamiliesExtract.familyVocabulary].sort()).toEqual(
      Object.keys(FAMILY_AXIS_NAMES).sort(),
    );
  });

  it('names every family the extract actually uses', () => {
    const used = new Set(
      variationFamiliesExtract.patterns.flatMap((pattern) => [
        ...pattern.tier1Families,
        ...pattern.tier2Families,
      ]),
    );

    // A used family with no entry here is a silent coverage hole: the category
    // would simply stop suggesting anything, with nothing reporting it.
    const unnamed = [...used].filter(
      (family) => FAMILY_AXIS_NAMES[family] === undefined,
    );

    expect(unnamed).toEqual([]);
  });

  it('assigns every category a pattern that exists', () => {
    const codes = new Set(
      variationFamiliesExtract.patterns.map((pattern) => pattern.patternCode),
    );
    const orphans = variationFamiliesExtract.categories.filter(
      (assignment) => !codes.has(assignment.patternCode),
    );

    expect(orphans).toEqual([]);
  });

  it('records the workbook it came from', () => {
    expect(variationFamiliesExtract.source.workbook).toBe(
      'universal_category_variation_taxonomy_final_clean.xlsx',
    );
    expect(variationFamiliesExtract.source.taxonomyVersion).toBe(
      'sals3-taxonomy-v1',
    );
    expect(variationFamiliesExtract.categories).toHaveLength(5595);
  });
});
