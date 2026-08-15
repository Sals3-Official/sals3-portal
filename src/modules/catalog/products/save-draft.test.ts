import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: vi.fn(),
  saveDraftRevisionContent: vi.fn(),
  updateSellerRetailPrices: vi.fn(),
  updateProductEditorialForSteward: vi.fn(),
}));

/* eslint-disable import/first */
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

import saveProductDraft from './save-draft';
import type { SaveProductDraftInput } from './contracts';
import {
  findProductForSteward,
  saveDraftRevisionContent,
  updateSellerRetailPrices,
  updateProductEditorialForSteward,
} from './repository';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const DATABASE = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ marker: 'tx' }),
  ),
} as never;

const REQUEST = {
  productId: '11111111-1111-4111-8111-111111111111',
  revisionId: '22222222-2222-4222-8222-222222222222',
  expectedRevisionVersion: 3,
  title: 'Merino crew neck',
  sals3CategoryL1: 'Sporting Goods',
  descriptionDocument: {
    version: 1 as const,
    blocks: [{ type: 'paragraph' as const, text: 'Soft merino wool.' }],
  },
  variantRetailPrices: [
    {
      variantId: '33333333-3333-4333-8333-333333333333',
      amountMinor: 1999,
      currency: 'USD',
    },
  ],
} satisfies SaveProductDraftInput;

function run(sellerAccountId = 'seller-a') {
  return saveProductDraft({
    request: REQUEST,
    sellerAccountId,
    actorId: 'actor-1',
    database: DATABASE,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(appendAuditEvent).mockResolvedValue(undefined);
  asMock(findProductForSteward).mockResolvedValue({
    id: REQUEST.productId,
    stewardSellerAccountId: 'seller-a',
  });
  asMock(saveDraftRevisionContent).mockResolvedValue({
    id: REQUEST.revisionId,
    version: 4,
  });
  asMock(updateProductEditorialForSteward).mockResolvedValue({
    id: REQUEST.productId,
  });
  asMock(updateSellerRetailPrices).mockResolvedValue(1);
});

describe('saveProductDraft', () => {
  it('saves content and returns the advanced version', async () => {
    await expect(run()).resolves.toEqual({
      ok: true,
      revisionVersion: 4,
      contentChecksum: expect.any(String),
    });
  });

  it('passes a content checksum computed server-side, never one from the caller', async () => {
    await run();

    const [, args] = asMock(saveDraftRevisionContent).mock.calls[0];

    // The request schema has no checksum field at all; it is derived here so
    // the audit trail records what was actually stored.
    expect(args.contentChecksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses and writes nothing for a product this account does not steward', async () => {
    asMock(findProductForSteward).mockResolvedValue(null);

    await expect(run('seller-b')).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(saveDraftRevisionContent).not.toHaveBeenCalled();
    expect(updateProductEditorialForSteward).not.toHaveBeenCalled();
    expect(updateSellerRetailPrices).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it('reports a version conflict when the compare-and-set matched nothing', async () => {
    // Covers a stale editor, a replayed submit, and an attempt to rewrite an
    // already-submitted or approved revision - all indistinguishable outward.
    asMock(saveDraftRevisionContent).mockResolvedValue(null);

    await expect(run()).resolves.toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(updateProductEditorialForSteward).not.toHaveBeenCalled();
    expect(updateSellerRetailPrices).not.toHaveBeenCalled();
  });

  it('saves the draft L1 category without treating it as the leaf category id', async () => {
    await run();

    expect(updateProductEditorialForSteward).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: REQUEST.title,
        sals3CategoryL1: 'Sporting Goods',
      }),
    );
  });

  it('saves seller-entered retail prices on seller-scoped offers', async () => {
    await run();

    expect(updateSellerRetailPrices).toHaveBeenCalledWith(expect.anything(), {
      productId: REQUEST.productId,
      sellerAccountId: 'seller-a',
      prices: REQUEST.variantRetailPrices,
      actorId: 'actor-1',
    });
  });

  it('audits a rejected stale write rather than discarding it silently', async () => {
    asMock(saveDraftRevisionContent).mockResolvedValue(null);

    await run();

    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product_revision.save_rejected_stale',
        actorId: 'actor-1',
        payload: expect.objectContaining({ expectedVersion: 3 }),
      }),
    );
  });

  it('audits a successful save with both the previous and new version', async () => {
    await run();

    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product_revision.saved',
        payload: expect.objectContaining({
          previousVersion: 3,
          version: 4,
          pricedOfferCount: 1,
        }),
      }),
    );
  });

  it('runs the ownership check, the write, and the audit on one executor', async () => {
    await run();

    const executors = [
      asMock(findProductForSteward).mock.calls[0][0],
      asMock(saveDraftRevisionContent).mock.calls[0][0],
      asMock(updateSellerRetailPrices).mock.calls[0][0],
      asMock(appendAuditEvent).mock.calls[0][0],
    ];

    // A statement issued outside the transaction would run on a different
    // connection and could not see the uncommitted rows around it.
    executors.forEach((executor) => expect(executor).toEqual({ marker: 'tx' }));
  });
});
