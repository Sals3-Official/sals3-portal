import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  categoryAttributePayloadSchema,
  readVariationTiers,
  resolveCategoryFormContract,
  validateCategoryAttributes,
} from './category-form';
import type { CategoryFormContract } from './types';

const mocks = vi.hoisted(() => ({
  findCategoryByCode: vi.fn(),
  findPresetByCategoryCode: vi.fn(),
}));

vi.mock('./repository', () => mocks);

const EXECUTOR = {} as never;

const CATEGORY = {
  id: 'category-1',
  code: 'CAT-APP-100112',
  path: "Apparel > Women's Clothing > Tops > Blouses",
};

const PRESET = {
  id: 'preset-1',
  categoryId: 'category-1',
  taxonomyVersion: 'sals3-taxonomy-v0',
  variationArchitecture: '2-Tier (Color + Size)',
  tier1Attribute: 'Color / Camo Pattern',
  tier2Attribute: 'Garment Size (S/M/L/XL)',
  skuFormatStandard: '[PREFIX]-[COLOR]-[SIZE]',
  requiredItemAttributes: ['Color', 'Size', 'Fabric Material'],
  requiredItemAttributesRaw: 'Color, Size, Fabric Material',
  storeCatalogueStatus: 'Active Store Category (Bogs Store)',
  productExamples: null,
  sourceWorkbook: 'universal_category_variation_taxonomy.xlsx',
  sourceSheet: 'Universal_Category_Taxonomy',
  sourceChecksum: 'checksum-abc',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCategoryByCode.mockResolvedValue(CATEGORY);
  mocks.findPresetByCategoryCode.mockResolvedValue(PRESET);
});

async function contract() {
  const resolved = await resolveCategoryFormContract(EXECUTOR, {
    sals3CategoryCode: CATEGORY.code,
    taxonomyVersion: 'sals3-taxonomy-v0',
  });

  if (resolved.outcome !== 'CATEGORY_FORM_CONTRACT') {
    throw new Error('expected a contract');
  }

  return resolved;
}

describe('resolveCategoryFormContract', () => {
  it('returns the persisted preset as the required-attribute allow list and variation rules', async () => {
    const resolved = await contract();

    expect(resolved).toMatchObject({
      categoryCode: 'CAT-APP-100112',
      variationArchitecture: '2-Tier (Color + Size)',
      variationTiers: 'TWO_TIER',
      requiredAttributes: ['Color', 'Size', 'Fabric Material'],
      source: {
        workbook: 'universal_category_variation_taxonomy.xlsx',
        checksum: 'checksum-abc',
      },
    });
  });

  it('returns CATEGORY_NOT_FOUND for an unknown taxonomy code instead of an empty contract', async () => {
    mocks.findCategoryByCode.mockResolvedValue(null);

    const resolved = await resolveCategoryFormContract(EXECUTOR, {
      sals3CategoryCode: 'CAT-DOES-NOT-EXIST',
      taxonomyVersion: 'sals3-taxonomy-v0',
    });

    expect(resolved).toMatchObject({
      outcome: 'CATEGORY_FORM_UNAVAILABLE',
      reason: 'CATEGORY_NOT_FOUND',
    });
    expect(mocks.findPresetByCategoryCode).not.toHaveBeenCalled();
  });

  it('returns TAXONOMY_PRESET_UNAVAILABLE rather than "requires nothing" when the preset is absent', async () => {
    mocks.findPresetByCategoryCode.mockResolvedValue(null);

    const resolved = await resolveCategoryFormContract(EXECUTOR, {
      sals3CategoryCode: CATEGORY.code,
      taxonomyVersion: 'sals3-taxonomy-v9',
    });

    expect(resolved).toMatchObject({
      outcome: 'CATEGORY_FORM_UNAVAILABLE',
      reason: 'TAXONOMY_PRESET_UNAVAILABLE',
    });
  });
});

describe('readVariationTiers', () => {
  /**
   * Every `Variation Architecture` value the real workbook actually contains,
   * read straight out of the frozen extract. If a future extraction adds a
   * value this allow list cannot read, this test says so instead of the code
   * quietly guessing a tier count.
   */
  const architectures: string[] = (() => {
    const raw = readFileSync(
      join(
        __dirname,
        '../../../lib/db/seed-data/sals3-taxonomy-presets-v0.json',
      ),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as {
      patterns: Array<{ variationArchitecture: string | null }>;
    };

    return parsed.patterns
      .map((pattern) => pattern.variationArchitecture)
      .filter((value): value is string => value !== null);
  })();

  it('reads a tier count for every architecture in the frozen Taxonomy v0 extract', () => {
    expect(architectures.length).toBeGreaterThan(0);

    const unreadable = architectures.filter(
      (value) => readVariationTiers(value) === 'UNKNOWN',
    );

    expect(unreadable).toEqual([]);
  });

  it('reports UNKNOWN rather than guessing for an unrecognised or absent architecture', () => {
    expect(readVariationTiers(null)).toBe('UNKNOWN');
    expect(readVariationTiers('3-Tier (Color + Size + Length)')).toBe(
      'UNKNOWN',
    );
    expect(readVariationTiers('Freeform')).toBe('UNKNOWN');
  });
});

describe('validateCategoryAttributes', () => {
  it('accepts a payload that satisfies the preset exactly', async () => {
    const result = validateCategoryAttributes(await contract(), {
      Color: 'Navy',
      Size: 'M',
      'Fabric Material': 'Cotton',
    });

    expect(result.outcome).toBe('VALID');
    expect(result.acceptedAttributes).toEqual({
      Color: 'Navy',
      Size: 'M',
      'Fabric Material': 'Cotton',
    });
    expect(result.findings).toEqual([]);
  });

  it('reports a missing required attribute without inventing a value for it', async () => {
    const result = validateCategoryAttributes(await contract(), {
      Color: 'Navy',
      Size: 'M',
    });

    expect(result.outcome).toBe('NEEDS_REVIEW');
    expect(result.missingRequiredAttributes).toEqual(['Fabric Material']);
    expect(result.acceptedAttributes).not.toHaveProperty('Fabric Material');
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'REQUIRED_ATTRIBUTE_MISSING',
        attributeName: 'Fabric Material',
      }),
    );
  });

  it('treats a blank required attribute as missing, not as satisfied', async () => {
    const result = validateCategoryAttributes(await contract(), {
      Color: 'Navy',
      Size: '   ',
      'Fabric Material': 'Cotton',
    });

    expect(result.missingRequiredAttributes).toEqual(['Size']);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'REQUIRED_ATTRIBUTE_BLANK' }),
    );
  });

  it('preserves an unrecognised supplier option label instead of discarding it to pass', async () => {
    const result = validateCategoryAttributes(await contract(), {
      Color: 'Navy',
      Size: 'M',
      'Fabric Material': 'Cotton',
      'CJ Option: Sleeve Style': 'Puff sleeve',
    });

    expect(result.outcome).toBe('NEEDS_REVIEW');
    expect(result.unrecognizedAttributes).toEqual([
      { name: 'CJ Option: Sleeve Style', value: 'Puff sleeve' },
    ]);
    expect(result.acceptedAttributes).not.toHaveProperty(
      'CJ Option: Sleeve Style',
    );
  });

  it('reports an unreadable variation architecture rather than assuming one tier', async () => {
    mocks.findPresetByCategoryCode.mockResolvedValue({
      ...PRESET,
      variationArchitecture: '4-Tier (Something New)',
    });

    const result = validateCategoryAttributes(await contract(), {
      Color: 'Navy',
      Size: 'M',
      'Fabric Material': 'Cotton',
    });

    expect(result.outcome).toBe('NEEDS_REVIEW');
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'VARIATION_ARCHITECTURE_UNRECOGNIZED' }),
    );
  });

  it('never reports a market, price, margin, stock or publication claim', async () => {
    const serialized = JSON.stringify(
      validateCategoryAttributes(await contract(), { Color: 'Navy' }),
    ).toLowerCase();

    ['price', 'margin', 'stock', 'publish', 'ready'].forEach((forbidden) => {
      expect(serialized).not.toContain(forbidden);
    });
  });

  it('rejects a non-string or oversized attribute payload at the schema boundary', () => {
    expect(
      categoryAttributePayloadSchema.safeParse({ Color: { nested: true } })
        .success,
    ).toBe(false);
    expect(
      categoryAttributePayloadSchema.safeParse({ '': 'blank key' }).success,
    ).toBe(false);
    expect(
      categoryAttributePayloadSchema.safeParse({ Color: 'x'.repeat(2_001) })
        .success,
    ).toBe(false);
    expect(
      categoryAttributePayloadSchema.safeParse({ Color: 'Navy' }).success,
    ).toBe(true);
  });
});

describe('contract shape', () => {
  it('is a discriminated union so a caller cannot read a category off an unavailable contract', async () => {
    mocks.findCategoryByCode.mockResolvedValue(null);

    const resolved: CategoryFormContract = await resolveCategoryFormContract(
      EXECUTOR,
      { sals3CategoryCode: 'CAT-NOPE', taxonomyVersion: 'sals3-taxonomy-v0' },
    );

    expect(resolved).not.toHaveProperty('requiredAttributes');
    expect(resolved).not.toHaveProperty('categoryCode');
  });
});
