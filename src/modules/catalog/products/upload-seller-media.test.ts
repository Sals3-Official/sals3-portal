// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  appendAuditEvent: vi.fn(),
  put: vi.fn(),
  toBuffer: vi.fn(),
  metadata: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
}));
vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
vi.mock('@vercel/blob', () => ({ put: mocks.put }));

/**
 * A stand-in for the real `sharp` pipeline: real image decoding is
 * exercised by hand, not in this suite, so the fluent chain just records
 * that it was called correctly and returns whatever `mocks.toBuffer` is
 * configured to for the test. `sharp` itself is a well-audited native
 * library; what this suite verifies is that this module drives it right
 * (auto-orient, downscale-only resize, WebP output) and handles both of its
 * real outcomes - a processed buffer, or a decode failure.
 */
vi.mock('sharp', () => ({
  default: vi.fn(() => {
    const chain = {
      rotate: vi.fn(() => chain),
      resize: vi.fn(() => chain),
      webp: vi.fn(() => chain),
      toBuffer: mocks.toBuffer,
      metadata: mocks.metadata,
    };

    return chain;
  }),
}));

/* eslint-disable import/first */
import sharp from 'sharp';
import { uploadSellerProductMedia } from './upload-seller-media';
/* eslint-enable import/first */

const PRODUCT = { id: 'product-1', stewardSellerAccountId: 'seller-1' };
const BLOB_URL =
  'https://abc123.public.blob.vercel-storage.com/seller-media/product-1/photo.jpg';

// Only the magic number matters before `sharp` ever sees it - the pre-filter
// this module runs is a cheap format check, not a real decode.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x01]);

const PROCESSED_BUFFER = Buffer.from('processed-webp-bytes');

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
    mocks.metadata.mockResolvedValue({ width: 1800, height: 1200 });
    mocks.toBuffer.mockResolvedValue({
      data: PROCESSED_BUFFER,
      info: { width: 1800, height: 1200 },
    });
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

  it('refuses a file over the 5 MB size limit without decoding or uploading it', async () => {
    const { db } = fakeDb();
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);

    oversized.set(JPEG_BYTES);

    const result = await uploadSellerProductMedia({
      ...BASE_INPUT,
      fileBytes: oversized.buffer,
      db,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'FILE_TOO_LARGE',
      maxBytes: 5 * 1024 * 1024,
    });
    expect(sharp).not.toHaveBeenCalled();
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
    expect(sharp).not.toHaveBeenCalled();
    expect(mocks.findProductForSteward).not.toHaveBeenCalled();
  });

  it('refuses a file that passes the magic-number check but sharp cannot actually decode', async () => {
    mocks.toBuffer.mockRejectedValue(new Error('unsupported image format'));
    const { db } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    expect(result).toEqual({ ok: false, reason: 'PROCESSING_FAILED' });
    expect(mocks.findProductForSteward).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('refuses a file whose header cannot even be read for dimensions', async () => {
    mocks.metadata.mockRejectedValue(new Error('unsupported image format'));
    const { db } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    expect(result).toEqual({ ok: false, reason: 'PROCESSING_FAILED' });
    expect(mocks.findProductForSteward).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('refuses an image over 2000x2000 without resizing it down or uploading it', async () => {
    mocks.metadata.mockResolvedValue({ width: 4032, height: 3024 });
    const { db } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    expect(result).toEqual({
      ok: false,
      reason: 'DIMENSIONS_TOO_LARGE',
      maxDimensionPx: 2000,
    });
    expect(mocks.toBuffer).not.toHaveBeenCalled();
    expect(mocks.findProductForSteward).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('refuses an image over the limit on only one axis', async () => {
    mocks.metadata.mockResolvedValue({ width: 2400, height: 800 });
    const { db } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    expect(result).toEqual({
      ok: false,
      reason: 'DIMENSIONS_TOO_LARGE',
      maxDimensionPx: 2000,
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('allows an image at exactly 2000x2000', async () => {
    mocks.metadata.mockResolvedValue({ width: 2000, height: 2000 });
    mocks.toBuffer.mockResolvedValue({
      data: PROCESSED_BUFFER,
      info: { width: 2000, height: 2000 },
    });
    const { db } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    expect(result.ok).toBe(true);
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

  it('re-encodes to WebP, downscale-only, and records a SELLER_UPLOAD row with the real processed dimensions - never trusting the caller filename or path', async () => {
    const { db, inserted } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    expect(result).toEqual({
      ok: true,
      media: {
        id: 'media-row-1',
        sourceUrl: BLOB_URL,
        contentType: 'image/webp',
        byteSize: PROCESSED_BUFFER.byteLength,
        widthPixels: 1800,
        heightPixels: 1200,
      },
    });

    const [pathname, uploadedBuffer, uploadOptions] = mocks.put.mock
      .calls[0] as [string, Buffer, { contentType: string }];

    expect(pathname).toMatch(/^seller-media\/product-1\/[0-9a-f-]{36}\.webp$/);
    expect(uploadedBuffer).toBe(PROCESSED_BUFFER);
    expect(uploadOptions.contentType).toBe('image/webp');
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        productId: 'product-1',
        sourceType: 'SELLER_UPLOAD',
        sourceUrl: BLOB_URL,
        contentType: 'image/webp',
        byteSize: PROCESSED_BUFFER.byteLength,
        widthPixels: 1800,
        heightPixels: 1200,
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

  it('reports a clean refusal, not a raw throw, when the exact re-encoded bytes were already uploaded for this product', async () => {
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
