import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCategoryMapping } from './resolver';
import { toProductCategoryAssignment } from './integration';
import type { CategoryMappingResolutionInput } from './types';

const mocks = vi.hoisted(() => ({
  findActiveMapping: vi.fn(),
}));

vi.mock('./repository', () => mocks);

const EXECUTOR = {} as never;

const BASE_INPUT: CategoryMappingResolutionInput = {
  provider: 'CJ_DROPSHIPPING',
  externalCategoryId: 'cj-cat-1042',
  observedCategoryPath: 'Luggage & Bags > Backpacks > Casual Daypacks',
  taxonomyVersion: 'sals3-taxonomy-v0',
  expectedMappingVersion: null,
};

const CATEGORY = {
  id: 'category-1',
  code: 'CAT-MEN-100564',
  path: "Bags & Travel > Men's Bags > Backpacks > Daypacks",
};

function mapping(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping-1',
    provider: 'CJ_DROPSHIPPING',
    externalCategoryId: 'cj-cat-1042',
    observedCategoryPath: 'Luggage & Bags > Backpacks > Casual Daypacks',
    sals3CategoryId: 'category-1',
    taxonomyVersion: 'sals3-taxonomy-v0',
    mappingVersion: 3,
    supersedesId: 'mapping-0',
    method: 'EXTERNAL_ID_RULE',
    confidence: 'EXACT',
    reviewStatus: 'APPROVED',
    status: 'ACTIVE',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActiveMapping.mockResolvedValue({
    mapping: mapping(),
    category: CATEGORY,
  });
});

describe('resolveCategoryMapping', () => {
  it('resolves an exact external-id rule to the intended Sals3 code, path and mapping version', async () => {
    const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);

    expect(mocks.findActiveMapping).toHaveBeenCalledWith(
      EXECUTOR,
      'CJ_DROPSHIPPING',
      'cj-cat-1042',
    );
    expect(decision).toMatchObject({
      outcome: 'MAPPED_EXACT',
      needsReview: false,
      sals3CategoryCode: 'CAT-MEN-100564',
      sals3CategoryPath: CATEGORY.path,
      mappingId: 'mapping-1',
      mappingVersion: 3,
      method: 'EXTERNAL_ID_RULE',
      confidence: 'EXACT',
      taxonomyVersion: 'sals3-taxonomy-v0',
    });
  });

  it('resolves a reviewed acceptable rule as MAPPED_ACCEPTABLE, not EXACT', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mapping({
        confidence: 'ACCEPTABLE',
        method: 'REVIEWED_PATH_RULE',
      }),
      category: CATEGORY,
    });

    const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);

    expect(decision).toMatchObject({
      outcome: 'MAPPED_ACCEPTABLE',
      confidence: 'ACCEPTABLE',
      method: 'REVIEWED_PATH_RULE',
    });
  });

  it('returns UNMAPPED with no category when no rule exists', async () => {
    mocks.findActiveMapping.mockResolvedValue(null);

    const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);

    expect(decision).toEqual({
      outcome: 'UNMAPPED',
      needsReview: true,
      reason: 'NO_ACTIVE_MAPPING',
      reasonLabel: 'No approved category mapping',
      mappingId: null,
      mappingVersion: null,
      resolverVersion: expect.any(String),
    });
    expect(decision).not.toHaveProperty('sals3CategoryCode');
  });

  it('returns UNMAPPED for a malformed provider category without querying at all', async () => {
    const decisions = await Promise.all(
      [null, '', '   '].map((externalCategoryId) =>
        resolveCategoryMapping(EXECUTOR, { ...BASE_INPUT, externalCategoryId }),
      ),
    );

    decisions.forEach((decision) => {
      expect(decision).toMatchObject({
        outcome: 'UNMAPPED',
        reason: 'PROVIDER_CATEGORY_MISSING',
        needsReview: true,
      });
    });
    expect(mocks.findActiveMapping).not.toHaveBeenCalled();
  });

  it('returns AMBIGUOUS with no category for a rule reviewed as ambiguous', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mapping({ confidence: 'AMBIGUOUS', sals3CategoryId: null }),
      category: null,
    });

    const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);

    expect(decision).toMatchObject({
      outcome: 'AMBIGUOUS',
      reason: 'MAPPING_MARKED_AMBIGUOUS',
      needsReview: true,
      mappingId: 'mapping-1',
      mappingVersion: 3,
    });
    expect(decision).not.toHaveProperty('sals3CategoryCode');
  });

  it('returns UNMAPPED for a rule that explicitly decided this supplier category has no Sals3 home', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mapping({ confidence: 'UNMAPPED', sals3CategoryId: null }),
      category: null,
    });

    const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);

    expect(decision).toMatchObject({
      outcome: 'UNMAPPED',
      reason: 'MAPPING_MARKED_UNMAPPED',
    });
  });

  it('returns MAPPING_SUPERSEDED when the caller recorded an older mapping version', async () => {
    const decision = await resolveCategoryMapping(EXECUTOR, {
      ...BASE_INPUT,
      expectedMappingVersion: 2,
    });

    expect(decision).toMatchObject({
      outcome: 'MAPPING_SUPERSEDED',
      reason: 'MAPPING_VERSION_SUPERSEDED',
      needsReview: true,
      mappingVersion: 3,
    });
    expect(decision).not.toHaveProperty('sals3CategoryCode');
  });

  it('accepts the decision when the caller recorded the version that is still in force', async () => {
    const decision = await resolveCategoryMapping(EXECUTOR, {
      ...BASE_INPUT,
      expectedMappingVersion: 3,
    });

    expect(decision.outcome).toBe('MAPPED_EXACT');
  });

  it('refuses a mapping written against a different taxonomy extraction', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mapping({ taxonomyVersion: 'sals3-taxonomy-v1' }),
      category: CATEGORY,
    });

    const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);

    expect(decision).toMatchObject({
      outcome: 'AMBIGUOUS',
      reason: 'TAXONOMY_VERSION_MISMATCH',
    });
  });

  it('refuses rather than invents a category when a confident rule points at a missing taxonomy row', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mapping(),
      category: null,
    });

    const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);

    expect(decision).toMatchObject({
      outcome: 'AMBIGUOUS',
      reason: 'MAPPING_TARGET_CATEGORY_MISSING',
    });
  });

  it('is keyed only on the external category id — the observed path never selects a mapping', async () => {
    await resolveCategoryMapping(EXECUTOR, {
      ...BASE_INPUT,
      observedCategoryPath: 'Something Entirely Different > Nowhere',
    });

    expect(mocks.findActiveMapping).toHaveBeenCalledWith(
      EXECUTOR,
      'CJ_DROPSHIPPING',
      'cj-cat-1042',
    );
    expect(mocks.findActiveMapping).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a mapped decision', { mapping: mapping(), category: CATEGORY }],
    ['no mapping at all', null],
    [
      'an ambiguous mapping',
      {
        mapping: mapping({ confidence: 'AMBIGUOUS', sals3CategoryId: null }),
        category: null,
      },
    ],
  ])(
    'exposes no seller, connection or candidate identifier for %s',
    async (_label, found) => {
      mocks.findActiveMapping.mockResolvedValue(found);

      const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);
      const keys = Object.keys(decision).join(' ').toLowerCase();

      ['seller', 'connection', 'candidate', 'tenant'].forEach((forbidden) => {
        expect(keys).not.toContain(forbidden);
      });
    },
  );

  it('never carries a market, price, margin, stock, Ready or published claim', async () => {
    const decision = await resolveCategoryMapping(EXECUTOR, BASE_INPUT);
    const serialized = JSON.stringify(decision).toLowerCase();

    [
      'market',
      'price',
      'margin',
      'stock',
      'ready',
      'publish',
      'approved for sale',
      '"au"',
      '"ph"',
    ].forEach((forbidden) => {
      expect(serialized).not.toContain(forbidden);
    });
  });
});

describe('toProductCategoryAssignment', () => {
  it('carries the code, confidence and mapping version for a mapped decision', async () => {
    const assignment = toProductCategoryAssignment(
      await resolveCategoryMapping(EXECUTOR, BASE_INPUT),
    );

    expect(assignment).toMatchObject({
      categoryCode: 'CAT-MEN-100564',
      categoryMappingConfidence: 'EXACT',
      mappingId: 'mapping-1',
      mappingVersion: 3,
      requiresCategoryReview: false,
    });
  });

  it.each([
    ['NO_ACTIVE_MAPPING', null, 'UNMAPPED'],
    [
      'MAPPING_MARKED_AMBIGUOUS',
      {
        mapping: mapping({ confidence: 'AMBIGUOUS', sals3CategoryId: null }),
        category: null,
      },
      'AMBIGUOUS',
    ],
  ] as const)(
    'never names a category for %s and always demands review',
    async (_case, found, expectedConfidence) => {
      mocks.findActiveMapping.mockResolvedValue(found);

      const assignment = toProductCategoryAssignment(
        await resolveCategoryMapping(EXECUTOR, BASE_INPUT),
      );

      expect(assignment.categoryCode).toBeNull();
      expect(assignment.categoryPath).toBeNull();
      expect(assignment.categoryMappingConfidence).toBe(expectedConfidence);
      expect(assignment.requiresCategoryReview).toBe(true);
    },
  );

  it('reports a superseded mapping as AMBIGUOUS so pricing refuses it', async () => {
    const assignment = toProductCategoryAssignment(
      await resolveCategoryMapping(EXECUTOR, {
        ...BASE_INPUT,
        expectedMappingVersion: 1,
      }),
    );

    expect(assignment.categoryMappingConfidence).toBe('AMBIGUOUS');
    expect(assignment.requiresCategoryReview).toBe(true);
  });
});
