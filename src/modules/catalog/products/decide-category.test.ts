// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideProductSals3Category } from './decide-category';

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  findCategoryByCode: vi.fn(),
  assignProductCategory: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
}));
vi.mock('@/modules/catalog/taxonomy/repository', () => ({
  findCategoryByCode: mocks.findCategoryByCode,
  assignProductCategory: mocks.assignProductCategory,
}));
vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

const TX = {} as never;

const DB = { transaction: (fn: (tx: unknown) => unknown) => fn(TX) } as never;

const PRODUCT = {
  id: 'product-1',
  stewardSellerAccountId: 'seller-1',
  version: 4,
  categoryId: 'category-old',
};

const CATEGORY = {
  id: 'category-new',
  code: 'CAT-GGL-100230',
  path: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
};

const INPUT = {
  productId: 'product-1',
  sellerAccountId: 'seller-1',
  expectedProductVersion: 4,
  sals3CategoryCode: 'CAT-GGL-100230',
  reason: 'This is a real jacket, not a generic accessory.',
  actorId: 'actor-1',
  db: DB,
};

describe('decideProductSals3Category', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
    mocks.findCategoryByCode.mockResolvedValue(CATEGORY);
    mocks.assignProductCategory.mockResolvedValue({ ...PRODUCT, version: 5 });
  });

  it("refuses a product that does not exist, is not this seller's, or has moved version", async () => {
    mocks.findProductForSteward.mockResolvedValue(null);

    expect(await decideProductSals3Category(INPUT)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(mocks.findCategoryByCode).not.toHaveBeenCalled();
    expect(mocks.assignProductCategory).not.toHaveBeenCalled();
  });

  it('refuses a stale product version without looking up the category', async () => {
    mocks.findProductForSteward.mockResolvedValue({
      ...PRODUCT,
      version: 9,
    });

    expect(await decideProductSals3Category(INPUT)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(mocks.findCategoryByCode).not.toHaveBeenCalled();
  });

  it('refuses an unrecognised Sals3 category code instead of inventing one', async () => {
    mocks.findCategoryByCode.mockResolvedValue(null);

    const result = await decideProductSals3Category(INPUT);

    expect(result).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_SALS3_CATEGORY',
    });
    expect(mocks.assignProductCategory).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it('resolves the code against the real Sals3 Taxonomy v1 table, never trusting a caller-supplied path', async () => {
    await decideProductSals3Category(INPUT);

    expect(mocks.findCategoryByCode).toHaveBeenCalledWith(TX, 'CAT-GGL-100230');
    expect(mocks.assignProductCategory).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        categoryId: 'category-new',
        categoryMappingConfidence: 'EXACT',
        // No provider_category_mappings row backs a directly-declared
        // category — this is the whole point of the per-seller model.
        categoryMappingId: null,
        categoryMappingVersion: null,
      }),
    );
  });

  it('declares the decision to a single product, not a shared CJ-category mapping', async () => {
    const result = await decideProductSals3Category(INPUT);

    expect(result).toEqual({
      ok: true,
      categoryCode: 'CAT-GGL-100230',
      categoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
      productVersion: 5,
    });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'product.category_declared',
        entityType: 'product',
        entityId: 'product-1',
        payload: expect.objectContaining({
          sellerAccountId: 'seller-1',
          categoryCode: 'CAT-GGL-100230',
          previousCategoryId: 'category-old',
        }),
      }),
    );
  });

  it('reports a stale write when the compare-and-set loses a race', async () => {
    mocks.assignProductCategory.mockResolvedValue(null);

    expect(await decideProductSals3Category(INPUT)).toEqual({
      ok: false,
      reason: 'STALE_WRITE',
    });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it("scopes the product lookup to the caller's own seller account", async () => {
    await decideProductSals3Category({ ...INPUT, sellerAccountId: 'seller-2' });

    expect(mocks.findProductForSteward).toHaveBeenCalledWith(
      TX,
      'product-1',
      'seller-2',
    );
  });
});
