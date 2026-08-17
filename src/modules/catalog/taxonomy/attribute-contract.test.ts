import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  categoryAttributeSubmissionSchema,
  resolveCategoryAttributeContract,
  validateCategoryAttributeSubmission,
} from './attribute-contract';
import type { CategoryAttributeContract } from './attribute-types';

const mocks = vi.hoisted(() => ({
  findCategoryByCode: vi.fn(),
  findAttributeControlsByCategoryCode: vi.fn(),
}));

vi.mock('./repository', () => mocks);

const EXECUTOR = {} as never;

const CATEGORY = {
  id: 'category-1',
  code: 'CAT-GGL-1',
  path: 'Animals & Pet Supplies > Pet Supplies',
};

const CONTROL_ROWS = [
  {
    attributeName: 'Brand',
    requirementLevel: 'REQUIRED',
    inputControlType: 'SINGLE_SELECT_DROPDOWN',
    allowedValues: ['UNBRANDED', 'Royal Canin', 'Purina'],
    allowCustomValue: true,
    allowMultipleValues: false,
    sellerHelpText: 'Official pet brand or manufacturer.',
    seoVisibility: 'STRUCTURED_DATA_ELIGIBLE',
    aeoGeoVisibility: 'ANSWER_SUMMARY_USEFUL',
    sourceWorkbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
    sourceSheet: 'Category_Attribute_Controls',
    sourceChecksum: 'checksum-abc',
  },
  {
    attributeName: 'Life Stage Compatibility',
    requirementLevel: 'RECOMMENDED',
    inputControlType: 'MULTI_SELECT_DROPDOWN',
    allowedValues: ['Puppy / Kitten', 'Adult', 'Senior'],
    allowCustomValue: false,
    allowMultipleValues: true,
    sellerHelpText: null,
    seoVisibility: 'PDP_VISIBLE',
    aeoGeoVisibility: 'ATTRIBUTE_CONTEXT_ONLY',
    sourceWorkbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
    sourceSheet: 'Category_Attribute_Controls',
    sourceChecksum: 'checksum-abc',
  },
  {
    attributeName: 'Care Instructions',
    requirementLevel: 'OPTIONAL',
    inputControlType: 'TEXT_INPUT',
    allowedValues: [],
    allowCustomValue: true,
    allowMultipleValues: false,
    sellerHelpText: null,
    seoVisibility: 'ATTRIBUTE_CONTEXT_ONLY',
    aeoGeoVisibility: 'ATTRIBUTE_CONTEXT_ONLY',
    sourceWorkbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
    sourceSheet: 'Category_Attribute_Controls',
    sourceChecksum: 'checksum-abc',
  },
  {
    attributeName: 'Net Weight',
    requirementLevel: 'REQUIRED',
    inputControlType: 'MEASUREMENT_INPUT',
    allowedValues: [],
    allowCustomValue: false,
    allowMultipleValues: false,
    sellerHelpText: null,
    seoVisibility: 'PDP_VISIBLE',
    aeoGeoVisibility: 'ATTRIBUTE_CONTEXT_ONLY',
    sourceWorkbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
    sourceSheet: 'Category_Attribute_Controls',
    sourceChecksum: 'checksum-abc',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCategoryByCode.mockResolvedValue(CATEGORY);
  mocks.findAttributeControlsByCategoryCode.mockResolvedValue(CONTROL_ROWS);
});

async function contract() {
  const resolved = await resolveCategoryAttributeContract(EXECUTOR, {
    sals3CategoryCode: CATEGORY.code,
    controlsVersion: 'sals3-attribute-controls-v1',
  });

  if (resolved.outcome !== 'CATEGORY_ATTRIBUTE_CONTRACT') {
    throw new Error('expected a contract');
  }

  return resolved;
}

describe('resolveCategoryAttributeContract', () => {
  it('returns the persisted control rows as the allow list', async () => {
    const resolved = await contract();

    expect(resolved).toMatchObject({
      categoryCode: 'CAT-GGL-1',
      controlsVersion: 'sals3-attribute-controls-v1',
      source: {
        workbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
        checksum: 'checksum-abc',
      },
    });
    expect(resolved.controls).toHaveLength(4);
  });

  it('returns CATEGORY_NOT_FOUND for an unknown category instead of an empty contract', async () => {
    mocks.findCategoryByCode.mockResolvedValue(null);

    const resolved = await resolveCategoryAttributeContract(EXECUTOR, {
      sals3CategoryCode: 'CAT-DOES-NOT-EXIST',
      controlsVersion: 'sals3-attribute-controls-v1',
    });

    expect(resolved).toMatchObject({
      outcome: 'CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE',
      reason: 'CATEGORY_NOT_FOUND',
    });
    expect(mocks.findAttributeControlsByCategoryCode).not.toHaveBeenCalled();
  });

  it('returns ATTRIBUTE_CONTROLS_UNAVAILABLE rather than "requires nothing" when no controls exist', async () => {
    mocks.findAttributeControlsByCategoryCode.mockResolvedValue([]);

    const resolved = await resolveCategoryAttributeContract(EXECUTOR, {
      sals3CategoryCode: CATEGORY.code,
      controlsVersion: 'sals3-attribute-controls-v9',
    });

    expect(resolved).toMatchObject({
      outcome: 'CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE',
      reason: 'ATTRIBUTE_CONTROLS_UNAVAILABLE',
    });
  });
});

describe('validateCategoryAttributeSubmission', () => {
  it('accepts a payload that satisfies every control', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['Royal Canin'],
      'Life Stage Compatibility': ['Adult', 'Senior'],
      'Net Weight': ['1.5 kg'],
    });

    expect(result.outcome).toBe('VALID');
    expect(result.acceptedAttributes).toEqual({
      Brand: { values: ['Royal Canin'], isCustomValue: false },
      'Life Stage Compatibility': {
        values: ['Adult', 'Senior'],
        isCustomValue: false,
      },
      'Net Weight': { values: ['1.5 kg'], isCustomValue: false },
    });
    expect(result.findings).toEqual([]);
  });

  it('reports a missing required attribute without inventing a value for it', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      'Net Weight': ['1.5 kg'],
    });

    expect(result.outcome).toBe('NEEDS_REVIEW');
    expect(result.missingRequiredAttributes).toEqual(['Brand']);
    expect(result.acceptedAttributes).not.toHaveProperty('Brand');
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'REQUIRED_ATTRIBUTE_MISSING',
        attributeName: 'Brand',
      }),
    );
  });

  it('treats a blank-only required value as missing, not as satisfied', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['   '],
      'Net Weight': ['1.5 kg'],
    });

    expect(result.missingRequiredAttributes).toEqual(['Brand']);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'REQUIRED_ATTRIBUTE_BLANK' }),
    );
  });

  it('reports a missing recommended attribute as a separate, non-blocking list', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['Royal Canin'],
      'Net Weight': ['1.5 kg'],
    });

    expect(result.missingRecommendedAttributes).toEqual([
      'Life Stage Compatibility',
    ]);
    expect(result.missingRequiredAttributes).toEqual([]);
  });

  it('never reports a missing optional attribute anywhere', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['Royal Canin'],
      'Net Weight': ['1.5 kg'],
    });

    expect(result.missingRequiredAttributes).not.toContain('Care Instructions');
    expect(result.missingRecommendedAttributes).not.toContain(
      'Care Instructions',
    );
    expect(
      result.findings.some((f) => f.attributeName === 'Care Instructions'),
    ).toBe(false);
  });

  it('rejects a dropdown value outside Allowed Values when no custom value is permitted', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['Royal Canin'],
      'Life Stage Compatibility': ['Senior Citizen Pets'],
      'Net Weight': ['1.5 kg'],
    });

    expect(result.outcome).toBe('NEEDS_REVIEW');
    expect(result.acceptedAttributes).not.toHaveProperty(
      'Life Stage Compatibility',
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'VALUE_NOT_IN_ALLOWED_LIST',
        attributeName: 'Life Stage Compatibility',
      }),
    );
  });

  it('accepts a dropdown value outside Allowed Values when a custom value is permitted, and flags it', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['Local Artisan Brand'],
      'Life Stage Compatibility': ['Adult'],
      'Net Weight': ['1.5 kg'],
    });

    expect(result.outcome).toBe('VALID');
    expect(result.acceptedAttributes.Brand).toEqual({
      values: ['Local Artisan Brand'],
      isCustomValue: true,
    });
  });

  it('keeps only the first value and reports the rest when a single-value control receives multiple', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['Royal Canin', 'Purina'],
      'Net Weight': ['1.5 kg'],
    });

    expect(result.acceptedAttributes.Brand).toEqual({
      values: ['Royal Canin'],
      isCustomValue: false,
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'MULTIPLE_VALUES_NOT_PERMITTED',
        attributeName: 'Brand',
      }),
    );
  });

  it('rejects a measurement value that does not match the expected shape', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['Royal Canin'],
      'Net Weight': ['heavy'],
    });

    expect(result.outcome).toBe('NEEDS_REVIEW');
    expect(result.acceptedAttributes).not.toHaveProperty('Net Weight');
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        code: 'VALUE_SHAPE_INVALID',
        attributeName: 'Net Weight',
      }),
    );
  });

  it('preserves an attribute the contract does not recognize instead of discarding it to pass', async () => {
    const result = validateCategoryAttributeSubmission(await contract(), {
      Brand: ['Royal Canin'],
      'Net Weight': ['1.5 kg'],
      'CJ Option: Sleeve Style': ['Puff sleeve'],
    });

    expect(result.outcome).toBe('NEEDS_REVIEW');
    expect(result.unrecognizedAttributes).toEqual([
      { name: 'CJ Option: Sleeve Style', values: ['Puff sleeve'] },
    ]);
    expect(result.acceptedAttributes).not.toHaveProperty(
      'CJ Option: Sleeve Style',
    );
  });

  it('never reports a market, price, margin, stock or publication claim', async () => {
    const serialized = JSON.stringify(
      validateCategoryAttributeSubmission(await contract(), {
        Brand: ['Royal Canin'],
      }),
    ).toLowerCase();

    ['price', 'margin', 'stock', 'publish', 'ready'].forEach((forbidden) => {
      expect(serialized).not.toContain(forbidden);
    });
  });

  it('rejects a non-array or oversized submission at the schema boundary', () => {
    expect(
      categoryAttributeSubmissionSchema.safeParse({ Brand: 'Royal Canin' })
        .success,
    ).toBe(false);
    expect(
      categoryAttributeSubmissionSchema.safeParse({ '': ['blank key'] })
        .success,
    ).toBe(false);
    expect(
      categoryAttributeSubmissionSchema.safeParse({
        Brand: ['x'.repeat(2_001)],
      }).success,
    ).toBe(false);
    expect(
      categoryAttributeSubmissionSchema.safeParse({ Brand: ['Royal Canin'] })
        .success,
    ).toBe(true);
  });
});

describe('contract shape', () => {
  it('is a discriminated union so a caller cannot read controls off an unavailable contract', async () => {
    mocks.findCategoryByCode.mockResolvedValue(null);

    const resolved: CategoryAttributeContract =
      await resolveCategoryAttributeContract(EXECUTOR, {
        sals3CategoryCode: 'CAT-NOPE',
        controlsVersion: 'sals3-attribute-controls-v1',
      });

    expect(resolved).not.toHaveProperty('controls');
    expect(resolved).not.toHaveProperty('categoryCode');
  });
});
