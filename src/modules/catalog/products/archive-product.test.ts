// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findProductForSteward = vi.fn();
const archiveProductForSteward = vi.fn();
const appendAuditEvent = vi.fn();

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => unknown) => run({}),
  }),
}));

vi.mock('./repository', () => ({
  findProductForSteward: (...args: unknown[]) => findProductForSteward(...args),
  archiveProductForSteward: (...args: unknown[]) =>
    archiveProductForSteward(...args),
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: (...args: unknown[]) => appendAuditEvent(...args),
}));

const { default: archiveProduct } = await import('./archive-product');

const INPUT = {
  sellerAccountId: 'seller-a',
  productId: 'product-a',
  actorId: 'actor-a',
};

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-a',
    title: 'Folding Camp Chair',
    publicationState: 'UNPUBLISHED',
    version: 3,
    ...overrides,
  };
}

describe('archiveProduct', () => {
  beforeEach(() => {
    findProductForSteward.mockReset();
    archiveProductForSteward.mockReset();
    appendAuditEvent.mockReset();
  });

  it('archives a draft and records an audit event', async () => {
    findProductForSteward.mockResolvedValue(product());
    archiveProductForSteward.mockResolvedValue(
      product({ publicationState: 'ARCHIVED', version: 4 }),
    );

    await expect(archiveProduct(INPUT)).resolves.toEqual({
      kind: 'archived',
      productId: 'product-a',
      title: 'Folding Camp Chair',
    });
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'catalog_product.archived' }),
    );
  });

  /** A foreign product must be indistinguishable from a missing one. */
  it('reports not-found for another tenant product and writes nothing', async () => {
    findProductForSteward.mockResolvedValue(null);

    await expect(archiveProduct(INPUT)).resolves.toEqual({
      kind: 'not-found',
      productId: 'product-a',
    });
    expect(archiveProductForSteward).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it('treats a second archive as idempotent, not an error', async () => {
    findProductForSteward.mockResolvedValue(
      product({ publicationState: 'ARCHIVED' }),
    );

    await expect(archiveProduct(INPUT)).resolves.toMatchObject({
      kind: 'already-archived',
    });
    expect(archiveProductForSteward).not.toHaveBeenCalled();
  });

  it('refuses a published product without attempting the write', async () => {
    findProductForSteward.mockResolvedValue(
      product({ publicationState: 'PUBLISHED' }),
    );

    await expect(archiveProduct(INPUT)).resolves.toMatchObject({
      kind: 'published',
    });
    expect(archiveProductForSteward).not.toHaveBeenCalled();
  });

  it('records a lost race instead of silently doing nothing', async () => {
    findProductForSteward.mockResolvedValue(product());
    archiveProductForSteward.mockResolvedValue(null);

    await expect(archiveProduct(INPUT)).resolves.toEqual({
      kind: 'stale',
      productId: 'product-a',
    });
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product.archive_rejected_stale',
      }),
    );
  });

  it('passes the version it read as the expected version', async () => {
    findProductForSteward.mockResolvedValue(product({ version: 9 }));
    archiveProductForSteward.mockResolvedValue(
      product({ publicationState: 'ARCHIVED', version: 10 }),
    );

    await archiveProduct(INPUT);

    expect(archiveProductForSteward).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedVersion: 9,
        stewardSellerAccountId: 'seller-a',
      }),
    );
  });
});
