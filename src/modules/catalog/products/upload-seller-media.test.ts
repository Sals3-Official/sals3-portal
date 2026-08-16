// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  appendAuditEvent: vi.fn(),
  put: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
}));
vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock('@vercel/blob', () => ({ put: mocks.put }));

/* eslint-disable import/first */
import { uploadSellerProductMedia } from './upload-seller-media';
/* eslint-enable import/first */

const PRODUCT = { id: 'product-1', stewardSellerAccountId: 'seller-1' };
const BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/seller-media/product-1/photo.jpg';

// A minimal real JPEG magic number, padded so the size checks below have
// room to work with either side of a small threshold.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x01]);

function fakeDb(
  options: {
    existingSellerMediaCount?: number;
    insertError?: unknown;
  } = {},
) {
  const inserted: unknown[] = [];
  const existingRows = Array.from(
    { length: options.existingSellerMediaCount ?? 0 },
    (_, index) => ({ id: `existing-${index}` }),
  );

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(existingRows)),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        inserted.push(values);

        return {
          returning: vi.fn(() => {
            if (options.insertError !== undefined) {
              throw options.insertError;
            }

            return Promise.resolve([{ id: 'media-row-1' }]);
          }),
        };
      }),
    })),
  };

  return { db: db as never, inserted };
}

const BASE_INPUT = {
  productId: 'product-1',
  sellerAccountId: 'seller-1',
  actorId: 'actor-1',
  fileBytes: JPEG_BYTES.buffer,
};

describe('uploadSellerProductMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
    mocks.put.mockResolvedValue({ url: BLOB_URL });
  });

  it('refuses when storage is not configured', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { db } = fakeDb();

    expect(await uploadSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'STORAGE_NOT_CONFIGURED',
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('refuses an empty file before checking ownership', async () => {
    const { db } = fakeDb();

    expect(
      await uploadSellerProductMedia({
        ...BASE_INPUT,
        fileBytes: new ArrayBuffer(0),
        db,
      }),
    ).toEqual({ ok: false, reason: 'EMPTY_FILE' });
    expect(mocks.findProductForSteward).not.toHaveBeenCalled();
  });

  it('refuses a file over the size limit without uploading it', async () => {
    const { db } = fakeDb();
    const oversized = new Uint8Array(8 * 1024 * 1024 + 1);

    oversized.set(JPEG_BYTES);

    const result = await uploadSellerProductMedia({
      ...BASE_INPUT,
      fileBytes: oversized.buffer,
      db,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'FILE_TOO_LARGE',
      maxBytes: 8 * 1024 * 1024,
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('refuses a file whose real bytes are not an accepted image type, regardless of what it claims to be', async () => {
    const { db } = fakeDb();
    const notAnImage = new TextEncoder().encode('<html>not a photo</html>');

    const result = await uploadSellerProductMedia({
      ...BASE_INPUT,
      fileBytes: notAnImage.buffer,
      db,
    });

    expect(result).toEqual({ ok: false, reason: 'UNSUPPORTED_FILE_TYPE' });
    expect(mocks.findProductForSteward).not.toHaveBeenCalled();
  });

  it("refuses a product that does not exist or is not this seller's", async () => {
    mocks.findProductForSteward.mockResolvedValue(null);
    const { db } = fakeDb();

    expect(await uploadSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('refuses once the product already has the maximum number of seller photos', async () => {
    const { db } = fakeDb({ existingSellerMediaCount: 12 });

    expect(await uploadSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'LIMIT_REACHED',
      limit: 12,
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('uploads to Vercel Blob and records a SELLER_UPLOAD row, never trusting the caller filename or path', async () => {
    const { db, inserted } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    expect(result).toEqual({
      ok: true,
      media: {
        id: 'media-row-1',
        sourceUrl: BLOB_URL,
        contentType: 'image/jpeg',
        byteSize: JPEG_BYTES.byteLength,
      },
    });

    const [pathname] = mocks.put.mock.calls[0] as [string];

    expect(pathname).toMatch(/^seller-media\/product-1\/[0-9a-f-]{36}\.jpg$/);
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        productId: 'product-1',
        sourceType: 'SELLER_UPLOAD',
        sourceUrl: BLOB_URL,
        contentType: 'image/jpeg',
        rightsBasis: 'SELLER_DECLARED',
        reviewState: 'APPROVED',
        createdBy: 'actor-1',
      }),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: 'catalog_product_media.seller_uploaded',
        entityType: 'ProductMediaSource',
        entityId: 'media-row-1',
      }),
    );
  });

  it('refuses a non-Blob URL from `put` rather than writing an unverifiable row', async () => {
    mocks.put.mockResolvedValue({
      url: 'https://evil.example.com/not-really-blob.jpg',
    });
    const { db, inserted } = fakeDb();

    expect(await uploadSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'UPLOAD_FAILED',
    });
    expect(inserted).toHaveLength(0);
  });

  it('reports a clean refusal, not a raw throw, when the exact bytes were already uploaded for this product', async () => {
    const { db } = fakeDb({
      insertError: {
        code: '23505',
        constraint_name: 'product_media_sources_product_checksum_key',
      },
    });

    expect(await uploadSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'DUPLICATE_FILE',
    });
  });

  it('re-throws an unrelated database error rather than mislabelling it', async () => {
    const { db } = fakeDb({ insertError: new Error('connection reset') });

    await expect(
      uploadSellerProductMedia({ ...BASE_INPUT, db }),
    ).rejects.toThrow('connection reset');
  });
});
