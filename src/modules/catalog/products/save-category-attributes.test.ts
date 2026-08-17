// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productCategoryAttributeValues, products } from '@/lib/db/schema';

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  findCategoryById: vi.fn(),
  resolveCategoryAttributeContract: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
}));
vi.mock('@/modules/catalog/taxonomy/repository', () => ({
  findCategoryById: mocks.findCategoryById,
}));
vi.mock(
  '@/modules/catalog/taxonomy/attribute-contract',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/modules/catalog/taxonomy/attribute-contract')
      >();

    return {
      ...actual,
      resolveCategoryAttributeContract: mocks.resolveCategoryAttributeContract,
    };
  },
);
vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

const saveCategoryAttributes = (await import('./save-category-attributes'))
  .default;

const PRODUCT_ID = 'a1a1a1a1-1111-4111-8111-111111111111';
const SELLER_ID = 'b2b2b2b2-2222-4222-8222-222222222222';
const ACTOR_ID = 'actor-1';

const PRODUCT = {
  id: PRODUCT_ID,
  stewardSellerAccountId: SELLER_ID,
  version: 4,
  categoryId: 'category-1',
};

const CATEGORY = {
  id: 'category-1',
  code: 'CAT-GGL-1',
  path: 'Animals & Pet Supplies',
};

const CONTRACT = {
  outcome: 'CATEGORY_ATTRIBUTE_CONTRACT' as const,
  categoryCode: 'CAT-GGL-1',
  categoryPath: 'Animals & Pet Supplies',
  controlsVersion: 'sals3-attribute-controls-v1',
  controls: [
    {
      attributeName: 'Brand',
      requirementLevel: 'REQUIRED' as const,
      inputControlType: 'SINGLE_SELECT_DROPDOWN' as const,
      allowedValues: ['UNBRANDED', 'Royal Canin'],
      allowCustomValue: true,
      allowMultipleValues: false,
      sellerHelpText: null,
      seoVisibility: 'STRUCTURED_DATA_ELIGIBLE' as const,
      aeoGeoVisibility: 'ANSWER_SUMMARY_USEFUL' as const,
    },
  ],
  source: {
    workbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
    sheet: 'Category_Attribute_Controls',
    checksum: 'checksum-abc',
  },
  contractVersion: 'category-attribute-contract-v1',
};

/** Records every write, mirroring `save-option-mapping.test.ts`'s pattern for this module family. */
function transactionalDb() {
  const writes: {
    table: unknown;
    op: string;
    values?: Record<string, unknown>;
  }[] = [];

  const tx = {
    insert: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.values = vi.fn((values: Record<string, unknown>) => {
        writes.push({ table, op: 'insert', values });

        return chain;
      });
      chain.onConflictDoUpdate = vi.fn(
        (config: { set: Record<string, unknown> }) => {
          writes.push({ table, op: 'upsert', values: config.set });

          return Promise.resolve(undefined);
        },
      );

      return chain;
    }),
    delete: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.where = vi.fn(() => {
        writes.push({ table, op: 'delete' });

        return Promise.resolve(undefined);
      });

      return chain;
    }),
    update: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.set = vi.fn((values: Record<string, unknown>) => {
        writes.push({ table, op: 'update', values });

        return chain;
      });
      chain.where = vi.fn(() => Promise.resolve(undefined));

      return chain;
    }),
  };

  const db = { transaction: (fn: (tx: unknown) => unknown) => fn(tx) };

  return { db, writes };
}

const BASE_INPUT = {
  productId: PRODUCT_ID,
  sellerAccountId: SELLER_ID,
  actorId: ACTOR_ID,
  expectedProductVersion: 4,
};

describe('saveCategoryAttributes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
    mocks.findCategoryById.mockResolvedValue(CATEGORY);
    mocks.resolveCategoryAttributeContract.mockResolvedValue(CONTRACT);
  });

  it("refuses a product that does not exist or is not this seller's", async () => {
    mocks.findProductForSteward.mockResolvedValue(null);
    const { db } = transactionalDb();

    const result = await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: { Brand: ['Royal Canin'] },
      db: db as never,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(mocks.resolveCategoryAttributeContract).not.toHaveBeenCalled();
  });

  it('reports a version conflict, not not_found, for a product that exists but moved version', async () => {
    mocks.findProductForSteward.mockResolvedValue({ ...PRODUCT, version: 9 });
    const { db } = transactionalDb();

    const result = await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: { Brand: ['Royal Canin'] },
      db: db as never,
    });

    expect(result).toEqual({ ok: false, reason: 'version_conflict' });
    expect(mocks.resolveCategoryAttributeContract).not.toHaveBeenCalled();
  });

  it('refuses a product with no category assigned yet', async () => {
    mocks.findProductForSteward.mockResolvedValue({
      ...PRODUCT,
      categoryId: null,
    });
    const { db } = transactionalDb();

    const result = await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: { Brand: ['Royal Canin'] },
      db: db as never,
    });

    expect(result).toEqual({ ok: false, reason: 'NO_CATEGORY_ASSIGNED' });
    expect(mocks.findCategoryById).not.toHaveBeenCalled();
  });

  it('refuses when the category has no attribute controls for the active version', async () => {
    mocks.resolveCategoryAttributeContract.mockResolvedValue({
      outcome: 'CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE',
      reason: 'ATTRIBUTE_CONTROLS_UNAVAILABLE',
      reasonLabel: 'No category attribute controls for this category',
      contractVersion: 'category-attribute-contract-v1',
    });
    const { db } = transactionalDb();

    const result = await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: { Brand: ['Royal Canin'] },
      db: db as never,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'ATTRIBUTE_CONTROLS_UNAVAILABLE',
    });
  });

  it('re-validates server-side and upserts an accepted attribute', async () => {
    const { db, writes } = transactionalDb();

    const result = await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: { Brand: ['Royal Canin'] },
      db: db as never,
    });

    expect(result).toMatchObject({ ok: true, productVersion: 5 });
    if (result.ok) {
      expect(result.validation.outcome).toBe('VALID');
      expect(result.validation.acceptedAttributes.Brand).toEqual({
        values: ['Royal Canin'],
        isCustomValue: false,
      });
    }

    const upsert = writes.find(
      (w) => w.table === productCategoryAttributeValues && w.op === 'upsert',
    );

    expect(upsert?.values).toMatchObject({
      values: ['Royal Canin'],
      isCustomValue: false,
    });
  });

  it('deletes a stale stored value when the resubmission does not validate', async () => {
    const { db, writes } = transactionalDb();

    const result = await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: { Brand: [] },
      db: db as never,
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.validation.missingRequiredAttributes).toEqual(['Brand']);
    }

    expect(
      writes.some(
        (w) => w.table === productCategoryAttributeValues && w.op === 'delete',
      ),
    ).toBe(true);
    expect(
      writes.some(
        (w) => w.table === productCategoryAttributeValues && w.op === 'upsert',
      ),
    ).toBe(false);
  });

  it('never touches an attribute name absent from the submission entirely', async () => {
    const { db, writes } = transactionalDb();

    await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: {},
      db: db as never,
    });

    expect(
      writes.filter((w) => w.table === productCategoryAttributeValues),
    ).toEqual([]);
  });

  it('preserves an attribute the contract does not recognize instead of dropping it', async () => {
    const { db, writes } = transactionalDb();

    const result = await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: {
        Brand: ['Royal Canin'],
        'CJ Option: Sleeve Style': ['Puff sleeve'],
      },
      db: db as never,
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.validation.unrecognizedAttributes).toEqual([
        { name: 'CJ Option: Sleeve Style', values: ['Puff sleeve'] },
      ]);
    }

    const preserved = writes.find(
      (w) =>
        w.table === productCategoryAttributeValues &&
        w.op === 'upsert' &&
        JSON.stringify(w.values?.values) === JSON.stringify(['Puff sleeve']),
    );

    expect(preserved).toBeDefined();
  });

  it('advances the product version and records an audit event on success', async () => {
    const { db, writes } = transactionalDb();

    await saveCategoryAttributes({
      ...BASE_INPUT,
      attributes: { Brand: ['Royal Canin'] },
      db: db as never,
    });

    expect(
      writes.find((w) => w.table === products && w.op === 'update')?.values,
    ).toMatchObject({ version: 5 });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ACTOR_ID,
        action: 'catalog_product.category_attributes_saved',
        entityType: 'product',
        entityId: PRODUCT_ID,
      }),
    );
  });
});
