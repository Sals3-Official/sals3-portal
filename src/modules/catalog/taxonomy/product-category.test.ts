import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyResolvedCategoryToProduct } from './product-category';
import type { ProviderCategoryFacts } from './types';

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  resolveCategoryMapping: vi.fn(),
  assignProductCategory: vi.fn(),
  clearProductCategory: vi.fn(),
  findCategoryByCode: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock('@/modules/catalog/products/repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
}));
vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock('./resolver', () => ({
  resolveCategoryMapping: mocks.resolveCategoryMapping,
}));
vi.mock('./repository', () => ({
  assignProductCategory: mocks.assignProductCategory,
  clearProductCategory: mocks.clearProductCategory,
  findCategoryByCode: mocks.findCategoryByCode,
}));

const TX = { tag: 'tx' };
const DB = {
  transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(TX),
} as never;

const PROVIDER_CATEGORY: ProviderCategoryFacts = {
  provider: 'CJ_DROPSHIPPING',
  externalCategoryId: 'cj-cat-1042',
  observedCategoryPath: 'Luggage & Bags > Backpacks',
};

const CATEGORY = {
  id: 'category-1',
  code: 'CAT-MEN-100564',
  path: "Bags & Travel > Men's Bags > Backpacks",
};

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    stewardSellerAccountId: 'seller-1',
    version: 4,
    categoryId: null,
    categoryMappingId: null,
    categoryMappingVersion: null,
    categoryMappingConfidence: 'UNMAPPED',
    ...overrides,
  };
}

const MAPPED = {
  outcome: 'MAPPED_EXACT' as const,
  needsReview: false as const,
  sals3CategoryCode: 'CAT-MEN-100564',
  sals3CategoryPath: CATEGORY.path,
  taxonomyVersion: 'sals3-taxonomy-v0',
  mappingId: 'mapping-9',
  mappingVersion: 3,
  method: 'EXTERNAL_ID_RULE' as const,
  confidence: 'EXACT' as const,
  reviewStatus: 'APPROVED' as const,
  observedCategoryPath: PROVIDER_CATEGORY.observedCategoryPath,
  resolverVersion: 'category-mapping-resolver-v1',
};

const REVIEW = {
  outcome: 'AMBIGUOUS' as const,
  needsReview: true as const,
  reason: 'MAPPING_MARKED_AMBIGUOUS' as const,
  reasonLabel: 'Category mapping is ambiguous',
  mappingId: 'mapping-9',
  mappingVersion: 3,
  resolverVersion: 'category-mapping-resolver-v1',
};

const INPUT = {
  productId: 'product-1',
  stewardSellerAccountId: 'seller-1',
  providerCategory: PROVIDER_CATEGORY,
  taxonomyVersion: 'sals3-taxonomy-v0',
  expectedProductVersion: 4,
  actorId: 'actor-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findProductForSteward.mockResolvedValue(product());
  mocks.resolveCategoryMapping.mockResolvedValue(MAPPED);
  mocks.findCategoryByCode.mockResolvedValue(CATEGORY);
  mocks.assignProductCategory.mockImplementation(
    async (_tx: unknown, i: Record<string, unknown>) =>
      product({ ...i, version: 5 }),
  );
  mocks.clearProductCategory.mockResolvedValue(product({ version: 5 }));
});

describe('applyResolvedCategoryToProduct', () => {
  it('writes the resolved category plus the mapping id and version that produced it', async () => {
    const result = await applyResolvedCategoryToProduct(DB, INPUT);

    expect(result.outcome).toBe('CATEGORY_ASSIGNED');
    expect(mocks.assignProductCategory).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        categoryId: 'category-1',
        categoryMappingConfidence: 'EXACT',
        categoryMappingId: 'mapping-9',
        categoryMappingVersion: 3,
        expectedVersion: 4,
        stewardSellerAccountId: 'seller-1',
      }),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'product.category_assigned' }),
    );
  });

  it('has no category parameter — the category can only come from the resolver', () => {
    expect(Object.keys(INPUT)).not.toContain('categoryCode');
    expect(Object.keys(INPUT)).not.toContain('categoryId');
    expect(Object.keys(INPUT)).not.toContain('sals3CategoryCode');
  });

  it('leaves a product UNMAPPED and clears provenance when the resolver says review', async () => {
    mocks.resolveCategoryMapping.mockResolvedValue(REVIEW);

    const result = await applyResolvedCategoryToProduct(DB, INPUT);

    expect(result.outcome).toBe('CATEGORY_REVIEW_REQUIRED');
    expect(mocks.assignProductCategory).not.toHaveBeenCalled();
    expect(mocks.clearProductCategory).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ productId: 'product-1', expectedVersion: 4 }),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'product.category_review_required' }),
    );
  });

  it('withdraws a category whose mapping has been superseded rather than leaving it standing', async () => {
    mocks.findProductForSteward.mockResolvedValue(
      product({
        categoryId: 'category-1',
        categoryMappingId: 'mapping-9',
        categoryMappingVersion: 2,
        categoryMappingConfidence: 'EXACT',
      }),
    );
    mocks.resolveCategoryMapping.mockResolvedValue({
      ...REVIEW,
      outcome: 'MAPPING_SUPERSEDED',
      reason: 'MAPPING_VERSION_SUPERSEDED',
    });

    const result = await applyResolvedCategoryToProduct(DB, INPUT);

    expect(result.outcome).toBe('CATEGORY_REVIEW_REQUIRED');
    expect(mocks.clearProductCategory).toHaveBeenCalled();
    // The version the product was assigned under is what gets revalidated.
    expect(mocks.resolveCategoryMapping).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ expectedMappingVersion: 2 }),
    );
  });

  it('answers NOT_FOUND identically for another tenant, a missing product and a stale version', async () => {
    mocks.findProductForSteward.mockResolvedValueOnce(null);
    const otherTenant = await applyResolvedCategoryToProduct(DB, INPUT);

    mocks.findProductForSteward.mockResolvedValueOnce(product({ version: 9 }));
    const staleVersion = await applyResolvedCategoryToProduct(DB, INPUT);

    expect(otherTenant).toEqual({ outcome: 'NOT_FOUND' });
    expect(staleVersion).toEqual(otherTenant);
    expect(mocks.resolveCategoryMapping).not.toHaveBeenCalled();
    expect(mocks.assignProductCategory).not.toHaveBeenCalled();
  });

  it('scopes every read and write to the steward from the caller, never a request field', async () => {
    await applyResolvedCategoryToProduct(DB, INPUT);

    expect(mocks.findProductForSteward).toHaveBeenCalledWith(
      TX,
      'product-1',
      'seller-1',
    );
    expect(mocks.assignProductCategory).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ stewardSellerAccountId: 'seller-1' }),
    );
  });

  it('rejects rather than assigns when the resolved code has no taxonomy row', async () => {
    mocks.findCategoryByCode.mockResolvedValue(null);

    const result = await applyResolvedCategoryToProduct(DB, INPUT);

    expect(result).toEqual({ outcome: 'NOT_FOUND' });
    expect(mocks.assignProductCategory).not.toHaveBeenCalled();
  });

  it('never writes a price, margin, market or publication field', async () => {
    await applyResolvedCategoryToProduct(DB, INPUT);

    const written = Object.keys(
      mocks.assignProductCategory.mock.calls[0][1] as Record<string, unknown>,
    )
      .join(' ')
      .toLowerCase();

    ['price', 'margin', 'market', 'publish', 'slug', 'stock'].forEach(
      (forbidden) => {
        expect(written).not.toContain(forbidden);
      },
    );
  });
});
