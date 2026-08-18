// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  appendAuditEvent: vi.fn(),
  send: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
}));
vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();

  return {
    ...actual,
    // Must be a real function, not an arrow, so `new S3Client(...)` works
    // under `vi.fn()`.
    // eslint-disable-next-line prefer-arrow-callback
    S3Client: vi.fn(function S3ClientMock() {
      return { send: mocks.send };
    }),
  };
});

/* eslint-disable import/first */
import { deleteSellerProductMedia } from './delete-seller-media';
/* eslint-enable import/first */

const PRODUCT = { id: 'product-1', stewardSellerAccountId: 'seller-1' };
const PUBLIC_BASE_URL = 'https://media.example-r2.dev';
const OBJECT_KEY = 'seller-media/product-1/photo.webp';
const SOURCE_URL = `${PUBLIC_BASE_URL}/${OBJECT_KEY}`;

const BASE_INPUT = {
  productId: 'product-1',
  mediaId: 'media-1',
  sellerAccountId: 'seller-1',
  actorId: 'actor-1',
};

function fakeDb(
  options: {
    deletedRow?: { sourceUrl: string | null; checksum: string } | undefined;
  } = {},
) {
  const deletedRow =
    'deletedRow' in options
      ? options.deletedRow
      : { sourceUrl: SOURCE_URL, checksum: 'checksum-1' };

  const db = {
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() =>
          Promise.resolve(deletedRow === undefined ? [] : [deletedRow]),
        ),
      })),
    })),
  };

  return db as never;
}

describe('deleteSellerProductMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLOUDFLARE_R2_ENDPOINT =
      'https://test-account.r2.cloudflarestorage.com';
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.CLOUDFLARE_R2_BUCKET = 'sals3-seller-media';
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = PUBLIC_BASE_URL;
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
    mocks.send.mockResolvedValue({});
  });

  it('reports NOT_FOUND without deleting the R2 object when the product is not this seller’s', async () => {
    mocks.findProductForSteward.mockResolvedValue(null);
    const db = fakeDb();

    expect(await deleteSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('reports NOT_FOUND when the row is a supplier photo or already gone, without deleting anything at R2', async () => {
    const db = fakeDb({ deletedRow: undefined });

    expect(await deleteSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('deletes the database row first and removes the matching R2 object by its key', async () => {
    const db = fakeDb();

    const result = await deleteSellerProductMedia({ ...BASE_INPUT, db });

    expect(result).toEqual({ ok: true });

    const command = mocks.send.mock.calls[0]?.[0] as {
      input: { Bucket: string; Key: string };
    };

    expect(command.input.Bucket).toBe('sals3-seller-media');
    expect(command.input.Key).toBe(OBJECT_KEY);
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: 'catalog_product_media.seller_deleted',
        entityType: 'ProductMediaSource',
        entityId: 'media-1',
      }),
    );
  });

  it('still reports success when the best-effort R2 delete fails, since the database row is already gone', async () => {
    mocks.send.mockRejectedValue(new Error('network error'));
    const db = fakeDb();

    expect(await deleteSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: true,
    });
    expect(mocks.appendAuditEvent).toHaveBeenCalled();
  });

  it('skips the R2 delete when storage is not configured here, without failing the request', async () => {
    delete process.env.CLOUDFLARE_R2_BUCKET;
    const db = fakeDb();

    expect(await deleteSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: true,
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('skips the R2 delete when the stored URL does not sit under the configured public base', async () => {
    const db = fakeDb({
      deletedRow: {
        sourceUrl: 'https://a-different-base.example.com/photo.webp',
        checksum: 'checksum-1',
      },
    });

    expect(await deleteSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: true,
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
