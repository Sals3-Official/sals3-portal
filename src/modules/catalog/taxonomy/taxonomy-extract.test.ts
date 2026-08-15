import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Provenance guard for the frozen Sals3 Taxonomy v1 preset extraction.
 *
 * The workbook lives in the sibling `sals3-ecommerce` vault and is never read
 * by this application — at runtime, at build time, or by these tests. What is
 * checked here is that the checked-in artifact still describes the source sheet
 * it claims to, and that its recorded checksum still describes its own
 * contents. A future re-extraction that drifts from either fails loudly instead
 * of silently changing what every category requires.
 *
 * v1 replaced v0 wholesale rather than extending it: the 21 L1 departments are
 * the Google Product Taxonomy top levels, the codes carry a `GGL` marker, and
 * not one of v0's 1,345 codes survives. That is why these numbers moved so far —
 * 1,345 records to 5,595, and 15 variation patterns to 86.
 */

const SEED_DATA_DIR = join(__dirname, '../../../lib/db/seed-data');

type PresetExtract = {
  source: {
    workbook: string;
    sheet: string;
    taxonomyVersion: string;
    dataRecords: number;
    distinctPresetPatterns: number;
    checksum: string;
    workbookSha256: string;
  };
  patterns: Array<{
    key: string;
    variationArchitecture: string | null;
    tier1Attribute: string | null;
    tier2Attribute: string | null;
    skuFormatStandard: string | null;
    requiredItemAttributesRaw: string | null;
    requiredItemAttributes: string[];
  }>;
  categories: Array<{
    code: string;
    presetKey: string;
    storeCatalogueStatus: string | null;
    productExamples: string | null;
  }>;
};

const extract = JSON.parse(
  readFileSync(join(SEED_DATA_DIR, 'sals3-taxonomy-presets-v1.json'), 'utf-8'),
) as PresetExtract;

const identities = JSON.parse(
  readFileSync(join(SEED_DATA_DIR, 'sals3-taxonomy-v1.json'), 'utf-8'),
) as Array<{ code: string; l1: string | null; path: string }>;

describe('Sals3 Taxonomy v1 preset extract', () => {
  it('matches the source sheet’s record and pattern counts', () => {
    expect(extract.categories).toHaveLength(5_595);
    expect(extract.source.dataRecords).toBe(5_595);
    expect(extract.patterns).toHaveLength(86);
    expect(extract.source.distinctPresetPatterns).toBe(86);
    // Architectures are 1:1 with patterns; SKU formats are not — several
    // architectures share one format string, so 86 patterns carry 47 formats.
    expect(
      new Set(extract.patterns.map((p) => p.variationArchitecture)).size,
    ).toBe(86);
    expect(new Set(extract.patterns.map((p) => p.skuFormatStandard)).size).toBe(
      47,
    );
  });

  it('recorded checksum still describes its own contents', () => {
    const recomputed = createHash('sha256')
      .update(
        JSON.stringify({
          patterns: extract.patterns,
          categories: extract.categories,
        }),
      )
      .digest('hex');

    expect(recomputed).toBe(extract.source.checksum);
  });

  it('shares one category identity with the taxonomy seed — no competing code set', () => {
    const identityCodes = new Set(identities.map((row) => row.code));

    expect(identityCodes.size).toBe(5_595);
    expect(
      extract.categories.filter((row) => !identityCodes.has(row.code)),
    ).toEqual([]);
  });

  it('assigns every category a preset that actually exists', () => {
    const keys = new Set(extract.patterns.map((pattern) => pattern.key));

    expect(
      extract.categories.filter((row) => !keys.has(row.presetKey)),
    ).toEqual([]);
  });

  it('splits required attributes without losing or inventing one', () => {
    extract.patterns.forEach((pattern) => {
      expect(pattern.requiredItemAttributes.length).toBeGreaterThan(0);
      expect(pattern.requiredItemAttributes.join(', ')).toBe(
        pattern.requiredItemAttributesRaw,
      );
    });
  });

  /**
   * v0 carried real example text on 6 of its 1,345 rows. v1 carries it on every
   * row, which is a change in the source workbook rather than something the
   * extraction invented — so this asserts the count instead of assuming the old
   * sparsity still holds.
   */
  it('keeps every example the workbook gives and fabricates none', () => {
    const populated = extract.categories.filter(
      (row) => row.productExamples !== null,
    );

    expect(populated).toHaveLength(5_595);
    // A bare `-` is the workbook's placeholder, not an example.
    expect(populated.every((row) => row.productExamples !== '-')).toBe(true);
  });

  /**
   * The reason v1 is worth adopting beyond tidiness: a category from this tree
   * is emittable as `google_product_category` without a second crosswalk. That
   * only holds while the department names stay verbatim, so renaming one to
   * sound more like Sals3 has to fail here.
   */
  it('keeps the Google Product Taxonomy top levels verbatim', () => {
    const departments = new Set(
      identities.map((row) => row.l1).filter((l1): l1 is string => l1 !== null),
    );

    expect(departments.size).toBe(21);
    [
      'Animals & Pet Supplies',
      'Apparel & Accessories',
      'Vehicles & Parts',
    ].forEach((name) => expect(departments.has(name)).toBe(true));
    expect(identities.every((row) => row.code.startsWith('CAT-GGL-'))).toBe(
      true,
    );
  });

  /**
   * `-` is the workbook's "no deeper level" marker. Reading it as text produced
   * paths like `Animals & Pet Supplies > - > - > - > -` in the first pass of
   * this extraction.
   */
  it('never renders the workbook’s placeholder as a path segment', () => {
    expect(identities.filter((row) => row.path.includes('> -'))).toEqual([]);
    expect(identities.filter((row) => row.path.trim() === '')).toEqual([]);
  });

  it('records the workbook provenance on the artifact itself', () => {
    expect(extract.source).toMatchObject({
      workbook: 'universal_category_variation_taxonomy.xlsx',
      sheet: 'Universal_Category_Taxonomy',
      taxonomyVersion: 'sals3-taxonomy-v1',
    });
    expect(extract.source.workbookSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
