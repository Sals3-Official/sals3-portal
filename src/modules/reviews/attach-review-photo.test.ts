// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/storage/r2-client', () => ({
  readR2Config: vi.fn(),
  getR2Client: vi.fn(() => ({ send: vi.fn(() => Promise.resolve({})) })),
}));

vi.mock('@/modules/catalog/products/image-upload-pipeline', () => ({
  OUTPUT_CONTENT_TYPE: 'image/webp',
  prepareUploadedImage: vi.fn(),
}));

/* eslint-disable import/first */
import { getR2Client, readR2Config } from '@/lib/storage/r2-client';
import { prepareUploadedImage } from '@/modules/catalog/products/image-upload-pipeline';
import attachReviewPhoto from './attach-review-photo';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';

const CONFIG = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  bucket: 'sals3',
  publicBaseUrl: 'https://media.sals3.example',
};

const INPUT = {
  reviewId: REVIEW_ID,
  buyerEmail: 'Buyer@Example.com',
  fileBytes: new ArrayBuffer(8),
};

function executorFor({
  found,
  existingPhotos,
  insert = 'ok',
}: {
  found: boolean;
  existingPhotos: number;
  insert?: 'ok' | 'duplicate';
}) {
  const wheres: unknown[] = [];
  let call = 0;

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((condition: unknown) => {
        wheres.push(condition);
        call += 1;

        // First select is the review lookup (chained `.limit`), second is the
        // photo count (awaited directly).
        return call === 1
          ? {
              limit: vi.fn(() =>
                Promise.resolve(found ? [{ id: REVIEW_ID }] : []),
              ),
            }
          : Promise.resolve([{ total: existingPhotos }]);
      }),
    })),
  }));

  const values = vi.fn(() => ({
    returning: vi.fn(() =>
      insert === 'duplicate'
        ? Promise.reject(Object.assign(new Error('dup'), { code: '23505' }))
        : Promise.resolve([{ id: 'photo-1' }]),
    ),
  }));

  return {
    executor: { select, insert: vi.fn(() => ({ values })) },
    values,
  };
}

function goodImage() {
  asMock(prepareUploadedImage).mockResolvedValue({
    ok: true,
    buffer: Buffer.from('webp-bytes'),
    width: 1200,
    height: 900,
  });
}

/**
 * `r2PublicImageUrl` reads `CLOUDFLARE_R2_PUBLIC_BASE_URL` from the environment
 * rather than from the config object, so the mocked `readR2Config` is not
 * enough on its own — without this every write is refused as an address outside
 * the configured base, which is the check doing its job.
 */
beforeEach(() => {
  process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL = CONFIG.publicBaseUrl;
});

afterEach(() => {
  delete process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;
});

describe('attachReviewPhoto', () => {
  it('stores the photo and reports the position it took', async () => {
    asMock(readR2Config).mockReturnValue(CONFIG);
    goodImage();

    const { executor, values } = executorFor({
      found: true,
      existingPhotos: 1,
    });

    await expect(attachReviewPhoto(INPUT, executor as never)).resolves.toEqual({
      ok: true,
      photoId: 'photo-1',
      position: 1,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: REVIEW_ID,
        position: 1,
        widthPixels: 1200,
        heightPixels: 900,
      }),
    );
  });

  /**
   * The address is validated against the configured public base before it is
   * written, so a row here can never point outside it — the same defence the
   * seller upload applies, and the read path's host check expects.
   */
  it('writes an address under the configured public base', async () => {
    asMock(readR2Config).mockReturnValue(CONFIG);
    goodImage();

    const { executor, values } = executorFor({
      found: true,
      existingPhotos: 0,
    });

    await attachReviewPhoto(INPUT, executor as never);

    const written = values.mock.calls.at(0)?.at(0) as unknown as {
      imageUrl: string;
    };

    expect(written.imageUrl.startsWith(CONFIG.publicBaseUrl)).toBe(true);
    // A random key, never anything a caller named (rule 31).
    expect(written.imageUrl).toContain('review-media/');
  });

  /**
   * An id alone is never enough. A caller holding the storefront bearer token
   * must not be able to attach a photo to somebody else's review, and the
   * refusal is the same one an unknown id gets so neither can be told from the
   * other.
   */
  it('refuses a review that is not this buyer, published, and real', async () => {
    asMock(readR2Config).mockReturnValue(CONFIG);
    goodImage();

    const { executor } = executorFor({ found: false, existingPhotos: 0 });

    await expect(attachReviewPhoto(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  /** Refused before the decode, so a doomed upload costs no re-encode. */
  it('refuses a fifth photo without processing the image', async () => {
    asMock(readR2Config).mockReturnValue(CONFIG);
    goodImage();
    asMock(prepareUploadedImage).mockClear();

    const { executor } = executorFor({ found: true, existingPhotos: 4 });

    await expect(attachReviewPhoto(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'LIMIT_REACHED',
    });
    expect(prepareUploadedImage).not.toHaveBeenCalled();
  });

  /**
   * `count` then `insert` has a window between the two. The unique index is
   * what actually decides, and a collision must not silently overwrite the
   * photo already at that position.
   */
  it('treats a raced position as the limit rather than replacing a photo', async () => {
    asMock(readR2Config).mockReturnValue(CONFIG);
    goodImage();

    const { executor } = executorFor({
      found: true,
      existingPhotos: 0,
      insert: 'duplicate',
    });

    await expect(attachReviewPhoto(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'LIMIT_REACHED',
    });
  });

  it('refuses honestly when storage is unconfigured, and reads nothing', async () => {
    asMock(readR2Config).mockReturnValue(null);

    const { executor } = executorFor({ found: true, existingPhotos: 0 });

    await expect(attachReviewPhoto(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'STORAGE_NOT_CONFIGURED',
    });
    expect(executor.select).not.toHaveBeenCalled();
  });

  /** The pipeline is the authority on what an acceptable image is; this passes it through. */
  it('passes a pipeline refusal back unchanged', async () => {
    asMock(readR2Config).mockReturnValue(CONFIG);
    asMock(prepareUploadedImage).mockResolvedValue({
      ok: false,
      reason: 'UNSUPPORTED_FILE_TYPE',
    });

    const { executor } = executorFor({ found: true, existingPhotos: 0 });

    await expect(attachReviewPhoto(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'UNSUPPORTED_FILE_TYPE',
    });
  });

  /** A row pointing at an object that was never stored is a broken image on a live page. */
  it('writes no row when the object store rejects the upload', async () => {
    asMock(readR2Config).mockReturnValue(CONFIG);
    goodImage();
    asMock(getR2Client).mockReturnValue({
      send: vi.fn(() => Promise.reject(new Error('503'))),
    });

    const { executor, values } = executorFor({
      found: true,
      existingPhotos: 0,
    });

    await expect(attachReviewPhoto(INPUT, executor as never)).resolves.toEqual({
      ok: false,
      reason: 'UPLOAD_FAILED',
    });
    expect(values).not.toHaveBeenCalled();

    asMock(getR2Client).mockReturnValue({
      send: vi.fn(() => Promise.resolve({})),
    });
  });
});
