import { describe, expect, it } from 'vitest';

import attributeControlsExtract from '@/lib/db/seed-data/sals3-category-attribute-controls-v1.json';

import {
  applyAttributeControlCorrections,
  NARROWED_CONTROL_VALUES,
  REMOVED_CONTROLS,
  SKIRT_ONLY_CATEGORY_CODES,
} from './attribute-control-corrections';

/**
 * These run against the **real extract**, not a fixture.
 *
 * The whole point of the corrections file is that it and the extract stay in
 * step. A fixture would let the extract change underneath it and still pass —
 * which is the failure mode being corrected here, one step removed.
 */
const { controls } = attributeControlsExtract as unknown as {
  controls: {
    categoryCode: string;
    attributeName: string;
    allowedValues: string[];
    requirementLevel: string;
    allowCustomValue: boolean;
  }[];
};

const DRESS_ONLY_VALUES = [
  'Maxi Dress',
  'Midi Dress',
  'Mini Dress',
  'Wrap Dress',
  'Slip Dress',
  'Bodycon',
];

describe('the skirt attribute-control corrections', () => {
  it('names controls that really are in the extract', () => {
    // A correction that matches nothing is a correction that silently does
    // nothing — the same defect as the extract being wrong, wearing a fix.
    REMOVED_CONTROLS.forEach((entry) => {
      const present = controls.some(
        (row) =>
          row.categoryCode === entry.categoryCode &&
          row.attributeName === entry.attributeName,
      );

      expect(present, `${entry.categoryCode} ${entry.attributeName}`).toBe(
        true,
      );
    });

    expect(REMOVED_CONTROLS).toHaveLength(8);
  });

  it('leaves Skirt Suits alone, because it comes with a jacket', () => {
    // CAT-GGL-1516 has a top half, so its neckline and sleeves are real
    // attributes of the product. Four categories, never five.
    expect(SKIRT_ONLY_CATEGORY_CODES).not.toContain('CAT-GGL-1516');

    const corrected = applyAttributeControlCorrections(controls);
    const suitAttributes = corrected
      .filter((row) => row.categoryCode === 'CAT-GGL-1516')
      .map((row) => row.attributeName);

    expect(suitAttributes).toContain('Neckline');
    expect(suitAttributes).toContain('Sleeve Style');
  });

  it('takes the top-half attributes off every skirt-only category', () => {
    const corrected = applyAttributeControlCorrections(controls);

    SKIRT_ONLY_CATEGORY_CODES.forEach((code) => {
      const attributes = corrected
        .filter((row) => row.categoryCode === code)
        .map((row) => row.attributeName);

      expect(attributes, code).not.toContain('Neckline');
      expect(attributes, code).not.toContain('Sleeve Style');
      // Everything else that belongs to a skirt stays.
      expect(attributes, code).toContain('Dress / Skirt Length');
      expect(attributes, code).toContain('Material');
    });
  });

  it('stops offering a dress as a skirt style', () => {
    const corrected = applyAttributeControlCorrections(controls);

    SKIRT_ONLY_CATEGORY_CODES.forEach((code) => {
      const style = corrected.find(
        (row) =>
          row.categoryCode === code &&
          row.attributeName === 'Dress / Skirt Style',
      );

      expect(style, code).toBeDefined();

      DRESS_ONLY_VALUES.forEach((value) => {
        expect(style?.allowedValues, `${code} ${value}`).not.toContain(value);
      });

      expect(style?.allowedValues).toEqual([
        'A-Line',
        'Pleated Skirt',
        'Pencil Skirt',
        'Tiered Boho',
      ]);
    });
  });

  it('narrows a control that accepts a custom value, so nothing live is stranded', () => {
    // The reason narrowing is safe on four already-published skirts: a stored
    // `Maxi Dress` is still accepted as a custom value rather than refused. If
    // this ever became false, narrowing would start rejecting live listings.
    NARROWED_CONTROL_VALUES.forEach((entry) => {
      const row = controls.find(
        (candidate) =>
          candidate.categoryCode === entry.categoryCode &&
          candidate.attributeName === entry.attributeName,
      );

      expect(row?.allowCustomValue, entry.categoryCode).toBe(true);
    });
  });

  it('changes nothing else in the extract', () => {
    const corrected = applyAttributeControlCorrections(controls);

    // Eight rows removed, and no row added or reordered.
    expect(corrected).toHaveLength(controls.length - 8);

    const untouched = corrected.filter(
      (row) =>
        !(SKIRT_ONLY_CATEGORY_CODES as readonly string[]).includes(
          row.categoryCode,
        ),
    );
    const originalUntouched = controls.filter(
      (row) =>
        !(SKIRT_ONLY_CATEGORY_CODES as readonly string[]).includes(
          row.categoryCode,
        ),
    );

    expect(untouched).toEqual(originalUntouched);
  });

  it('is idempotent, so a second pass is a no-op', () => {
    const once = applyAttributeControlCorrections(controls);
    const twice = applyAttributeControlCorrections(once);

    expect(twice).toEqual(once);
  });
});
