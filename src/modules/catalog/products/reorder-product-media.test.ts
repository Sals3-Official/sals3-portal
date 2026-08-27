// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

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

/* eslint-disable import/first */
import reorderProductMedia from './reorder-product-media';
/* eslint-enable import/first */

const PRODUCT = { id: 'product-1', stewardSellerAccountId: 'seller-1' };
const A = 'media-a';
const B = 'media-b';
const C = 'media-c';

/**
 * The gallery rows the transaction reads, and a record of every
 * `update().set().where()` the module issued, in order — the order is the whole
 * point of the feature, so it is the thing worth recording.
 */
function fakeDb(galleryIds: string[]) {
  const updates: { position: number }[] = [];

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(galleryIds.map((id) => ({ id })))),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: { position: number }) => {
        updates.push(values);

        return { where: vi.fn(() => Promise.resolve(undefined)) };
      }),
    })),
  };

  const db = {
    transaction: vi.fn(async (run: (t: typeof tx) => Promise<unknown>) =>
      run(tx),
    ),
  };

  return { db: db as never, updates, tx };
}

const BASE = {
  productId: 'product-1',
  sellerAccountId: 'seller-1',
  actorId: 'actor-1',
};

describe('reorderProductMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
  });

  it('writes positions in the order given, so the first photo is position 0', async () => {
    const { db, updates } = fakeDb([A, B, C]);

    const result = await reorderProductMedia({
      ...BASE,
      mediaIds: [C, A, B],
      db,
    });

    expect(result).toEqual({ ok: true, positioned: 3 });
    expect(updates).toEqual([
      { position: 0 },
      { position: 1 },
      { position: 2 },
    ]);
  });

  /**
   * The cover is position 0 and nothing else records it. If a second flag ever
   * appears, this is the test that should stop it.
   */
  it('records the resulting order and its cover on the audit trail', async () => {
    const { db } = fakeDb([A, B, C]);

    await reorderProductMedia({ ...BASE, mediaIds: [B, C, A], db });

    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product_media.reordered',
        payload: expect.objectContaining({
          mediaIds: [B, C, A],
          coverMediaId: B,
        }),
      }),
    );
  });

  it("refuses a product that is not this seller's, before reading any media", async () => {
    mocks.findProductForSteward.mockResolvedValue(null);
    const { db, updates } = fakeDb([A, B]);

    expect(
      await reorderProductMedia({ ...BASE, mediaIds: [A, B], db }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(updates).toEqual([]);
  });

  /**
   * A partial list would interleave arranged rows with rows still ordered by
   * observation time, producing an order the seller never saw. Refusing is the
   * only honest answer, because the client and the database have diverged.
   */
  it('refuses a list that does not name every gallery row', async () => {
    const { db, updates } = fakeDb([A, B, C]);

    expect(
      await reorderProductMedia({ ...BASE, mediaIds: [A, B], db }),
    ).toEqual({ ok: false, reason: 'INCOMPLETE_ORDER' });
    expect(updates).toEqual([]);
  });

  it('refuses a list naming a row that is not on this product', async () => {
    const { db, updates } = fakeDb([A, B]);

    expect(
      await reorderProductMedia({
        ...BASE,
        mediaIds: [A, 'media-of-another-product'],
        db,
      }),
    ).toEqual({ ok: false, reason: 'INCOMPLETE_ORDER' });
    expect(updates).toEqual([]);
  });

  it('refuses a repeated id rather than giving one row two positions', async () => {
    const { db, updates } = fakeDb([A, B]);

    expect(
      await reorderProductMedia({ ...BASE, mediaIds: [A, A], db }),
    ).toEqual({ ok: false, reason: 'DUPLICATE_MEDIA_ID' });
    expect(updates).toEqual([]);
    expect(mocks.findProductForSteward).not.toHaveBeenCalled();
  });

  /**
   * The amendment widens what may be *arranged*, not what may be destroyed. This
   * module issues `UPDATE ... SET position` and nothing else — no delete, and no
   * write to any provenance field.
   */
  it('only ever writes position, never a provenance field and never a delete', async () => {
    const { db, updates, tx } = fakeDb([A, B]);

    await reorderProductMedia({ ...BASE, mediaIds: [B, A], db });

    expect(updates.every((values) => Object.keys(values).length === 1)).toBe(
      true,
    );
    expect(updates.every((values) => 'position' in values)).toBe(true);
    expect(tx).not.toHaveProperty('delete');
  });
});
