import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Provenance and regression guard for the frozen category-attribute-controls
 * extraction (`Category_Attribute_Controls` + `Attribute_Control_Dictionary`
 * sheets of the finalized taxonomy workbook).
 *
 * The workbook lives in the sibling `sals3-ecommerce` vault and is never read
 * by this application - at runtime, at build time, or by these tests. What is
 * checked here is that the checked-in artifact still holds the invariants the
 * extraction script already asserted at extract time (exact row counts, zero
 * duplicate (category, attribute) pairs, the dropdown/allowed-values
 * invariant, dictionary <-> controls 1:1) so a hand edit or a bad re-run
 * regresses loudly instead of silently changing what a category's
 * Specification section requires.
 */

const SEED_DATA_DIR = join(__dirname, '../../../lib/db/seed-data');

type DictionaryEntry = {
  attributeName: string;
  canonicalAttributeKey: string;
  defaultInputControlType: string;
  defaultAllowedValues: string[];
  defaultAllowCustomValue: boolean;
  defaultAllowMultipleValues: boolean;
  dataType: string;
  notes: string | null;
};

type ControlEntry = {
  categoryCode: string;
  attributeName: string;
  requirementLevel: string;
  inputControlType: string;
  allowedValues: string[];
  allowCustomValue: boolean;
  allowMultipleValues: boolean;
  sellerHelpText: string | null;
  seoVisibility: string;
  aeoGeoVisibility: string;
  complianceReviewFlag: string;
  sourceBasis: string | null;
};

type ExtractionOutput = {
  source: {
    workbook: string;
    sheet: string;
    sha256: string;
    controlsVersion: string;
    dictionaryRowCount: number;
    controlRowCount: number;
  };
  controlsVersion: string;
  dictionary: DictionaryEntry[];
  controls: ControlEntry[];
};

const DROPDOWN_TYPES = new Set([
  'SINGLE_SELECT_DROPDOWN',
  'MULTI_SELECT_DROPDOWN',
]);

const extract = JSON.parse(
  readFileSync(
    join(SEED_DATA_DIR, 'sals3-category-attribute-controls-v1.json'),
    'utf-8',
  ),
) as ExtractionOutput;

const identities = JSON.parse(
  readFileSync(join(SEED_DATA_DIR, 'sals3-taxonomy-v1.json'), 'utf-8'),
) as Array<{ code: string }>;

describe('category attribute controls extract', () => {
  it('matches the source sheets’ exact record counts', () => {
    expect(extract.dictionary).toHaveLength(149);
    expect(extract.controls).toHaveLength(53_625);
    expect(extract.source.dictionaryRowCount).toBe(149);
    expect(extract.source.controlRowCount).toBe(53_625);
  });

  it('records the workbook provenance on the artifact itself', () => {
    expect(extract.source).toMatchObject({
      workbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
      sheet: 'Category_Attribute_Controls',
      controlsVersion: 'sals3-attribute-controls-v1',
    });
    expect(extract.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has zero duplicate (category, attribute) pairs', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    extract.controls.forEach((row) => {
      const key = `${row.categoryCode} ${row.attributeName}`;

      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    });

    expect(duplicates).toEqual([]);
  });

  it('gives every dropdown control at least one allowed value and every non-dropdown control none', () => {
    const violations = extract.controls.filter((row) => {
      const isDropdown = DROPDOWN_TYPES.has(row.inputControlType);

      return isDropdown
        ? row.allowedValues.length === 0
        : row.allowedValues.length > 0;
    });

    expect(violations).toEqual([]);
  });

  it('matches the dictionary and controls attribute-name sets exactly, in both directions', () => {
    const controlNames = new Set(
      extract.controls.map((row) => row.attributeName),
    );
    const dictionaryNames = new Set(
      extract.dictionary.map((row) => row.attributeName),
    );

    expect(dictionaryNames.size).toBe(extract.dictionary.length);
    expect(
      [...controlNames].filter((name) => !dictionaryNames.has(name)),
    ).toEqual([]);
    expect(
      [...dictionaryNames].filter((name) => !controlNames.has(name)),
    ).toEqual([]);
  });

  it('references only category codes that exist in the locked taxonomy identity set', () => {
    const identityCodes = new Set(identities.map((row) => row.code));
    const unknownCodes = new Set(
      extract.controls
        .map((row) => row.categoryCode)
        .filter((code) => !identityCodes.has(code)),
    );

    expect(unknownCodes.size).toBe(0);
  });

  it('never invents a canonical attribute key, and every key is non-blank', () => {
    extract.dictionary.forEach((entry) => {
      expect(entry.canonicalAttributeKey.trim().length).toBeGreaterThan(0);
      expect(entry.attributeName.trim().length).toBeGreaterThan(0);
    });
  });

  it('keeps requirement level to the three allow-listed values', () => {
    const levels = new Set(extract.controls.map((row) => row.requirementLevel));

    expect([...levels].sort()).toEqual(['OPTIONAL', 'RECOMMENDED', 'REQUIRED']);
  });

  it('keeps input control type within the seven allow-listed values', () => {
    const allowed = new Set([
      'SINGLE_SELECT_DROPDOWN',
      'MULTI_SELECT_DROPDOWN',
      'TEXT_INPUT',
      'NUMBER_INPUT',
      'MEASUREMENT_INPUT',
      'BOOLEAN_TOGGLE',
      'DATE_PICKER',
    ]);
    const used = new Set(extract.controls.map((row) => row.inputControlType));

    expect([...used].every((value) => allowed.has(value))).toBe(true);
  });
});
