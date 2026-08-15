// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideProductSals3Category } from './decide-category';

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  findProviderProductReferenceForProduct: vi.fn(),
  findCandidateSourceForSeller: vi.fn(),
  proposeCategoryMapping: vi.fn(),
  reviewCategoryMappingDecision: vi.fn(),
  applyResolvedCategoryToProduct: vi.fn(),
  findHighestMappingVersion: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
  findProviderProductReferenceForProduct:
    mocks.findProviderProductReferenceForProduct,
  findCandidateSourceForSeller: mocks.findCandidateSourceForSeller,
}));
vi.mock('@/modules/catalog/taxonomy/governance', () => ({
  proposeCategoryMapping: mocks.proposeCategoryMapping,
  reviewCategoryMappingDecision: mocks.reviewCategoryMappingDecision,
}));
vi.mock('@/modules/catalog/taxonomy/product-category', () => ({
  applyResolvedCategoryToProduct: mocks.applyResolvedCategoryToProduct,
}));
vi.mock('@/modules/catalog/taxonomy/repository', () => ({
  findHighestMappingVersion: mocks.findHighestMappingVersion,
}));

const DB = {} as never;

const PRODUCT = {
  id: 'product-1',
  stewardSellerAccountId: 'seller-1',
  version: 4,
};

const REFERENCE = { sourceCandidateId: 'candidate-1' };
const SOURCE = { providerCategoryId: 'cj-cat-1042' };

const MAPPING_PROPOSED = {
  id: 'mapping-9',
  status: 'PROPOSED',
  mappingVersion: 5,
};

const MAPPING_ACTIVATED = {
  ...MAPPING_PROPOSED,
  status: 'ACTIVE',
};

const MAPPED_DECISION = {
  outcome: 'MAPPED_EXACT',
  needsReview: false,
  sals3CategoryCode: 'CAT-GGL-100230',
  sals3CategoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
  mappingId: 'mapping-9',
  mappingVersion: 5,
};

const INPUT = {
  productId: 'product-1',
  sellerAccountId: 'seller-1',
  expectedProductVersion: 4,
  sals3CategoryCode: 'CAT-GGL-100230',
  reason: 'This is a real jacket category, not a mirrored passthrough.',
  actorId: 'actor-1',
  db: DB,
};

describe('decideProductSals3Category', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
    mocks.findProviderProductReferenceForProduct.mockResolvedValue(REFERENCE);
    mocks.findCandidateSourceForSeller.mockResolvedValue(SOURCE);
    mocks.findHighestMappingVersion.mockResolvedValue(4);
  });

  it("refuses a product that does not exist, is not this seller's, or has moved version", async () => {
    mocks.findProductForSteward.mockResolvedValue(null);

    expect(await decideProductSals3Category(INPUT)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(mocks.proposeCategoryMapping).not.toHaveBeenCalled();
  });

  it('refuses a product with no CJ supplier category on record', async () => {
    mocks.findProviderProductReferenceForProduct.mockResolvedValue(null);

    expect(await decideProductSals3Category(INPUT)).toEqual({
      ok: false,
      reason: 'NO_SUPPLIER_CATEGORY',
    });
    expect(mocks.proposeCategoryMapping).not.toHaveBeenCalled();
  });

  /**
   * The security-relevant case: the externalCategoryId is never accepted
   * from the caller. It must come from this product's own provider
   * reference, so a crafted payload cannot redirect a different CJ
   * category's mapping while appearing to edit this product.
   */
  it("derives externalCategoryId from the product's own provider reference, never from the caller", async () => {
    mocks.proposeCategoryMapping.mockResolvedValue({
      outcome: 'PROPOSED',
      mapping: MAPPING_PROPOSED,
    });
    mocks.reviewCategoryMappingDecision.mockResolvedValue({
      outcome: 'ACTIVATED',
      mapping: MAPPING_ACTIVATED,
    });
    mocks.applyResolvedCategoryToProduct.mockResolvedValue({
      outcome: 'CATEGORY_ASSIGNED',
      product: { ...PRODUCT, version: 5 },
      decision: MAPPED_DECISION,
    });

    await decideProductSals3Category(INPUT);

    expect(mocks.proposeCategoryMapping).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ externalCategoryId: 'cj-cat-1042' }),
    );
    expect(mocks.applyResolvedCategoryToProduct).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({
        providerCategory: expect.objectContaining({
          externalCategoryId: 'cj-cat-1042',
        }),
      }),
    );
  });

  it('refuses an unresolvable Sals3 category code before proposing anything real', async () => {
    mocks.proposeCategoryMapping.mockResolvedValue({
      outcome: 'INVALID',
      reason: 'SALS3_CATEGORY_NOT_FOUND',
    });

    const result = await decideProductSals3Category(INPUT);

    expect(result).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_SALS3_CATEGORY',
    });
    expect(mocks.reviewCategoryMappingDecision).not.toHaveBeenCalled();
    expect(mocks.applyResolvedCategoryToProduct).not.toHaveBeenCalled();
  });

  it('proposes, activates, and applies the decision to the product in one pass', async () => {
    mocks.proposeCategoryMapping.mockResolvedValue({
      outcome: 'PROPOSED',
      mapping: MAPPING_PROPOSED,
    });
    mocks.reviewCategoryMappingDecision.mockResolvedValue({
      outcome: 'ACTIVATED',
      mapping: MAPPING_ACTIVATED,
    });
    mocks.applyResolvedCategoryToProduct.mockResolvedValue({
      outcome: 'CATEGORY_ASSIGNED',
      product: { ...PRODUCT, version: 5 },
      decision: MAPPED_DECISION,
    });

    const result = await decideProductSals3Category(INPUT);

    expect(result).toEqual({
      ok: true,
      categoryCode: 'CAT-GGL-100230',
      categoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
      productVersion: 5,
    });
    expect(mocks.reviewCategoryMappingDecision).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({
        mappingId: 'mapping-9',
        decision: 'APPROVE_AND_ACTIVATE',
      }),
    );
  });

  /**
   * A replayed request whose mapping is already ACTIVE (e.g. a retried
   * double-submit) must not attempt to review an already-reviewed mapping —
   * it applies the already-active decision directly.
   */
  it('skips the review step for an already-active replayed proposal', async () => {
    mocks.proposeCategoryMapping.mockResolvedValue({
      outcome: 'ALREADY_PROPOSED',
      mapping: MAPPING_ACTIVATED,
    });
    mocks.applyResolvedCategoryToProduct.mockResolvedValue({
      outcome: 'CATEGORY_ASSIGNED',
      product: { ...PRODUCT, version: 5 },
      decision: MAPPED_DECISION,
    });

    const result = await decideProductSals3Category(INPUT);

    expect(result).toMatchObject({ ok: true });
    expect(mocks.reviewCategoryMappingDecision).not.toHaveBeenCalled();
  });

  it('reports a stale write when the review step loses a race', async () => {
    mocks.proposeCategoryMapping.mockResolvedValue({
      outcome: 'PROPOSED',
      mapping: MAPPING_PROPOSED,
    });
    mocks.reviewCategoryMappingDecision.mockResolvedValue({
      outcome: 'STALE_WRITE_REJECTED',
    });

    expect(await decideProductSals3Category(INPUT)).toEqual({
      ok: false,
      reason: 'STALE_WRITE',
    });
    expect(mocks.applyResolvedCategoryToProduct).not.toHaveBeenCalled();
  });

  it('reports a stale write when applying to the product loses a version race', async () => {
    mocks.proposeCategoryMapping.mockResolvedValue({
      outcome: 'PROPOSED',
      mapping: MAPPING_PROPOSED,
    });
    mocks.reviewCategoryMappingDecision.mockResolvedValue({
      outcome: 'ACTIVATED',
      mapping: MAPPING_ACTIVATED,
    });
    mocks.applyResolvedCategoryToProduct.mockResolvedValue({
      outcome: 'NOT_FOUND',
    });

    expect(await decideProductSals3Category(INPUT)).toEqual({
      ok: false,
      reason: 'STALE_WRITE',
    });
  });
});
