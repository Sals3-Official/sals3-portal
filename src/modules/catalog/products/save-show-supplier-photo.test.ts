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

const saveShowSupplierPhoto = (await import('./save-show-supplier-photo'))
  .default;

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
  showSupplierPhoto: false,
};

describe('saveShowSupplierPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
  });

  it("refuses a product that does not exist or is not this seller's", async () => {
    mocks.findProductForSteward.mockResolvedValue(null);
    const { db, tx } = fakeDb();

    expect(await saveShowSupplierPhoto({ ...INPUT, db })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('refuses a stale product version without writing', async () => {
    const { db, tx } = fakeDb();

    expect(
      await saveShowSupplierPhoto({
        ...INPUT,
        db,
        expectedProductVersion: 1,
      }),
    ).toEqual({ ok: false, reason: 'version_conflict' });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('writes the toggle and bumps the product version', async () => {
    const { db, writes } = fakeDb();

    const result = await saveShowSupplierPhoto({ ...INPUT, db });

    expect(result).toEqual({ ok: true, productVersion: 5 });
    expect(writes[0]).toEqual({
      table: products,
      values: expect.objectContaining({
        showSupplierPhoto: false,
        version: 5,
        updatedBy: 'actor-1',
      }),
    });
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'actor-1',
        action: 'catalog_product.show_supplier_photo_saved',
        entityType: 'product',
        entityId: 'product-1',
        payload: expect.objectContaining({
          sellerAccountId: 'seller-1',
          showSupplierPhoto: false,
        }),
      }),
    );
  });

  it('reports a version conflict when the compare-and-set loses a race', async () => {
    const { db } = fakeDb({ updateReturns: [] });

    expect(await saveShowSupplierPhoto({ ...INPUT, db })).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });
});
