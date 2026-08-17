// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { products } from '@/lib/db/schema';

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
}));
vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

const saveMetaDescription = (await import('./save-meta-description')).default;

const PRODUCT = {
  id: 'product-1',
  stewardSellerAccountId: 'seller-1',
  version: 4,
};

function fakeDb(options: { updateReturns?: { version: number }[] } = {}) {
  const writes: { table: unknown; values: Record<string, unknown> }[] = [];

  const tx = {
    update: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.set = vi.fn((values: Record<string, unknown>) => {
        writes.push({ table, values });

        return chain;
      });
      chain.where = vi.fn(() => chain);
      chain.returning = vi.fn(() =>
        Promise.resolve(options.updateReturns ?? [{ version: 5 }]),
      );

      return chain;
    }),
  };

  const db = {
    transaction: vi.fn(
      async (callback: (executor: unknown) => Promise<unknown>) => callback(tx),
    ),
  };

  return { db: db as never, tx, writes };
}

const INPUT = {
  productId: 'product-1',
  sellerAccountId: 'seller-1',
  actorId: 'actor-1',
  expectedProductVersion: 4,
  metaDescription: 'Waterproof packable daypack with a hidden laptop sleeve.',
};

describe('saveMetaDescription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
  });

  it("refuses a product that does not exist or is not this seller's", async () => {
    mocks.findProductForSteward.mockResolvedValue(null);
    const { db, tx } = fakeDb();

    expect(await saveMetaDescription({ ...INPUT, db })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('refuses a stale product version without writing', async () => {
    const { db, tx } = fakeDb();

    expect(
      await saveMetaDescription({ ...INPUT, db, expectedProductVersion: 1 }),
    ).toEqual({ ok: false, reason: 'version_conflict' });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('writes the meta description and bumps the product version', async () => {
    const { db, writes } = fakeDb();

    const result = await saveMetaDescription({ ...INPUT, db });

    expect(result).toEqual({ ok: true, productVersion: 5 });
    expect(writes[0]).toEqual({
      table: products,
      values: expect.objectContaining({
        metaDescription: INPUT.metaDescription,
        version: 5,
        updatedBy: 'actor-1',
      }),
    });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'catalog_product.meta_description_saved',
        entityType: 'product',
        entityId: 'product-1',
        payload: expect.objectContaining({
          sellerAccountId: 'seller-1',
          length: INPUT.metaDescription.length,
        }),
      }),
    );
  });

  it('stores `null` to clear it, not an empty string', async () => {
    const { db, writes } = fakeDb();

    await saveMetaDescription({ ...INPUT, db, metaDescription: null });

    expect(writes[0]?.values.metaDescription).toBeNull();
  });

  it('reports a version conflict when the compare-and-set loses a race', async () => {
    const { db } = fakeDb({ updateReturns: [] });

    expect(await saveMetaDescription({ ...INPUT, db })).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
