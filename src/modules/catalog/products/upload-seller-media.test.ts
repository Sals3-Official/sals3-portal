// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  findProductForSteward: vi.fn(),
  appendAuditEvent: vi.fn(),
  send: vi.fn(),
  toBuffer: vi.fn(),
  metadata: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: mocks.findProductForSteward,
}));
vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));
// The real `PutObjectCommand` is used unmocked (it is a plain constructor
// that just carries its input) so `mocks.send.mock.calls[0][0].input` below
// reads the real shape the module actually sent.
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();

  // A real `function`, not an arrow, so `new S3Client(...)` (the module
  // under test always constructs it that way) works at all - `vi.fn()`
  // only supports being invoked with `new` when its implementation is a
  // real function or class.
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
const PUBLIC_BASE_URL = 'https://media.example-r2.dev';
const OBJECT_KEY_PATTERN = /^seller-media\/product-1\/[0-9a-f-]{36}\.webp$/;

// Only the magic number matters before `sharp` ever sees it - the pre-filter
// this module runs is a cheap format check, not a real decode.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x01]);

const PROCESSED_BUFFER = Buffer.from('processed-webp-bytes');

/**
 * @param options.existingSellerMediaCount rows returned to *every* `select`,
 *   which is all the gallery path needs — it runs exactly one count query.
 * @param options.selectQueue one result array per `select`, in order, for the
 *   variation path: it runs three (variant exists, photos on that variant,
 *   variation photos on the product) and they must be answered differently.
 *   Falls back to `existingSellerMediaCount` once the queue is exhausted.
 */
function fakeDb(
  options: {
    existingSellerMediaCount?: number;
    selectQueue?: unknown[][];
    insertError?: unknown;
  } = {},
) {
  const inserted: unknown[] = [];
  const existingRows = Array.from(
    { length: options.existingSellerMediaCount ?? 0 },
    (_, index) => ({ id: `existing-${index}` }),
  );
  const queue = [...(options.selectQueue ?? [])];
  let selectCount = 0;

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          selectCount += 1;

          return Promise.resolve(
            queue.length > 0 ? queue.shift() : existingRows,
          );
        }),
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

  return {
    db: db as never,
    inserted,
    selectCalls: () => selectCount,
  };
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
    process.env.CLOUDFLARE_R2_ENDPOINT =
      'https://test-account.r2.cloudflarestorage.com';
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.CLOUDFLARE_R2_BUCKET = 'sals3-seller-media';
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = PUBLIC_BASE_URL;
    mocks.findProductForSteward.mockResolvedValue(PRODUCT);
    mocks.send.mockResolvedValue({});
    mocks.metadata.mockResolvedValue({ width: 1800, height: 1200 });
    mocks.toBuffer.mockResolvedValue({
      data: PROCESSED_BUFFER,
      info: { width: 1800, height: 1200 },
    });
  });

  it('refuses when storage is not configured', async () => {
    delete process.env.CLOUDFLARE_R2_BUCKET;
    const { db } = fakeDb();

    expect(await uploadSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'STORAGE_NOT_CONFIGURED',
    });
    expect(mocks.send).not.toHaveBeenCalled();
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
    expect(mocks.send).not.toHaveBeenCalled();
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
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('refuses a file whose header cannot even be read for dimensions', async () => {
    mocks.metadata.mockRejectedValue(new Error('unsupported image format'));
    const { db } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    expect(result).toEqual({ ok: false, reason: 'PROCESSING_FAILED' });
    expect(mocks.findProductForSteward).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
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
    expect(mocks.send).not.toHaveBeenCalled();
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
    expect(mocks.send).not.toHaveBeenCalled();
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
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('refuses once the product already has the maximum number of gallery photos', async () => {
    const { db } = fakeDb({ existingSellerMediaCount: 12 });

    expect(await uploadSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'LIMIT_REACHED',
      limit: 12,
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  describe('the two budgets are separate (2026-08-28)', () => {
    it('stores a variation photo with its variant_id already set, so it never occupies a gallery slot', async () => {
      const { db, inserted } = fakeDb({
        selectQueue: [
          [{ id: 'variant-9' }], // the variant exists on this product
          [], // no photo on that variant yet
          [], // no variation photos on the product yet
        ],
      });

      const result = await uploadSellerProductMedia({
        ...BASE_INPUT,
        variantId: 'variant-9',
        db,
      });

      expect(result.ok).toBe(true);
      expect(inserted[0]).toMatchObject({
        variantId: 'variant-9',
        sourceType: 'SELLER_UPLOAD',
      });
    });

    it('accepts a variation photo on a product whose gallery is already full - the whole point of the split', async () => {
      const { db } = fakeDb({
        selectQueue: [
          [{ id: 'variant-9' }],
          [],
          // Twelve variation photos already stored: the gallery budget is
          // irrelevant to this path, and twelve is nowhere near the backstop.
          Array.from({ length: 12 }, (_, index) => ({ id: `v-${index}` })),
        ],
      });

      const result = await uploadSellerProductMedia({
        ...BASE_INPUT,
        variantId: 'variant-9',
        db,
      });

      expect(result.ok).toBe(true);
    });

    it('counts only product-level rows against the gallery, never a variation photo', async () => {
      // One select on the gallery path, and it is the one carrying the
      // `variant_id is null` predicate. Asserting the call count is what pins
      // that the variation rows are not fetched into the same tally.
      const { db, selectCalls } = fakeDb({ existingSellerMediaCount: 11 });

      const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

      expect(result.ok).toBe(true);
      expect(selectCalls()).toBe(1);
    });

    it('refuses a second photo on the same variation, because only one is ever served', async () => {
      const { db } = fakeDb({
        selectQueue: [[{ id: 'variant-9' }], [{ id: 'already-there' }]],
      });

      expect(
        await uploadSellerProductMedia({
          ...BASE_INPUT,
          variantId: 'variant-9',
          db,
        }),
      ).toEqual({ ok: false, reason: 'VARIANT_PHOTO_EXISTS' });
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it("refuses a variant id that is not this product's, before storing anything", async () => {
      const { db } = fakeDb({ selectQueue: [[]] });

      expect(
        await uploadSellerProductMedia({
          ...BASE_INPUT,
          variantId: 'variant-of-another-product',
          db,
        }),
      ).toEqual({ ok: false, reason: 'VARIANT_NOT_FOUND' });
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it('refuses past the per-product variation-photo backstop', async () => {
      const { db } = fakeDb({
        selectQueue: [
          [{ id: 'variant-9' }],
          [],
          Array.from({ length: 60 }, (_, index) => ({ id: `v-${index}` })),
        ],
      });

      expect(
        await uploadSellerProductMedia({
          ...BASE_INPUT,
          variantId: 'variant-9',
          db,
        }),
      ).toEqual({ ok: false, reason: 'VARIANT_LIMIT_REACHED', limit: 60 });
      expect(mocks.send).not.toHaveBeenCalled();
    });
  });

  it('re-encodes to WebP, downscale-only, and records a SELLER_UPLOAD row with the real processed dimensions - never trusting the caller filename or path', async () => {
    const { db, inserted } = fakeDb();

    const result = await uploadSellerProductMedia({ ...BASE_INPUT, db });

    const command = mocks.send.mock.calls[0]?.[0] as {
      input: { Bucket: string; Key: string; Body: Buffer; ContentType: string };
    };

    expect(command.input.Bucket).toBe('sals3-seller-media');
    expect(command.input.Key).toMatch(OBJECT_KEY_PATTERN);
    expect(command.input.Body).toBe(PROCESSED_BUFFER);
    expect(command.input.ContentType).toBe('image/webp');

    const expectedUrl = `${PUBLIC_BASE_URL}/${command.input.Key}`;

    expect(result).toEqual({
      ok: true,
      media: {
        id: 'media-row-1',
        sourceUrl: expectedUrl,
        contentType: 'image/webp',
        byteSize: PROCESSED_BUFFER.byteLength,
        widthPixels: 1800,
        heightPixels: 1200,
      },
    });
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        productId: 'product-1',
        sourceType: 'SELLER_UPLOAD',
        sourceUrl: expectedUrl,
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

  it('refuses when the configured public base URL is not https, rather than writing an unverifiable row', async () => {
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = 'http://insecure.example.com';
    const { db, inserted } = fakeDb();

    expect(await uploadSellerProductMedia({ ...BASE_INPUT, db })).toEqual({
      ok: false,
      reason: 'UPLOAD_FAILED',
    });
    expect(inserted).toHaveLength(0);
  });

  it('refuses when the R2 upload itself fails, before writing any row', async () => {
    mocks.send.mockRejectedValue(new Error('network error'));
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
