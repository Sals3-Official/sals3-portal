import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Provenance guard for the frozen Sals3 Taxonomy v0 preset extraction.
 *
 * The workbook lives in the sibling `sals3-ecommerce` vault and is never read
 * by this application — at runtime, at build time, or by these tests. What is
 * checked here is that the checked-in artifact still matches the facts
 * ADR-002 verified about the source sheet, and that its recorded checksum
 * still describes its own contents. A future re-extraction that drifts from
 * either fails loudly instead of silently changing what every category
 * requires.
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
  readFileSync(join(SEED_DATA_DIR, 'sals3-taxonomy-presets-v0.json'), 'utf-8'),
) as PresetExtract;

const identities = JSON.parse(
  readFileSync(join(SEED_DATA_DIR, 'sals3-taxonomy-v0.json'), 'utf-8'),
) as Array<{ code: string }>;

describe('Sals3 Taxonomy v0 preset extract', () => {
  it("matches ADR-002's verified record and pattern counts", () => {
    expect(extract.categories).toHaveLength(1_345);
    expect(extract.source.dataRecords).toBe(1_345);
    // ADR-002: 15 variation architectures, 15 tier-1/tier-2/required-attribute
    // patterns, 14 SKU patterns across the 1,345 records.
    expect(extract.patterns).toHaveLength(15);
    expect(extract.source.distinctPresetPatterns).toBe(15);
    expect(
      new Set(extract.patterns.map((p) => p.variationArchitecture)).size,
    ).toBe(15);
    expect(new Set(extract.patterns.map((p) => p.skuFormatStandard)).size).toBe(
      14,
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

    expect(identityCodes.size).toBe(1_345);
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

  it('leaves the mostly-blank example column absent rather than filling it', () => {
    // ADR-002 verified 7 non-blank cells; one of those is a bare `-`
    // placeholder, so 6 carry real text and the rest stay null. Nothing
    // fabricates an example for the other 1,339.
    const populated = extract.categories.filter(
      (row) => row.productExamples !== null,
    );

    expect(populated).toHaveLength(6);
    expect(populated.every((row) => row.productExamples !== '-')).toBe(true);
  });

  it('records the workbook provenance on the artifact itself', () => {
    expect(extract.source).toMatchObject({
      workbook: 'universal_category_variation_taxonomy.xlsx',
      sheet: 'Universal_Category_Taxonomy',
      taxonomyVersion: 'sals3-taxonomy-v0',
    });
  });
});
