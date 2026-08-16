// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/session', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/modules/catalog/products/upload-seller-media', () => ({
  uploadSellerProductMedia: vi.fn(),
}));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { uploadSellerProductMedia } from '@/modules/catalog/products/upload-seller-media';
import { revalidatePath } from 'next/cache';

import { uploadSellerMediaAction } from './media-actions';
/* eslint-enable import/first */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function formDataWith(overrides: {
  productId?: string;
  file?: File | null;
}): FormData {
  const formData = new FormData();

  if (overrides.productId !== undefined) {
    formData.set('productId', overrides.productId);
  }

  if (overrides.file !== undefined && overrides.file !== null) {
    formData.set('file', overrides.file);
  }

  return formData;
}

function realFile(): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', {
    type: 'image/jpeg',
  });
}

const VALID_FORM_DATA = () =>
  formDataWith({ productId: PRODUCT_ID, file: realFile() });

function authorized() {
  vi.mocked(requirePermission).mockResolvedValue({
    sellerId: 'seller-1',
    userId: 'user-1',
    role: 'seller_manager',
    sellerBusinessModel: 'DROPSHIPPER',
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
}

describe('uploadSellerMediaAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDatabaseConfigured).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    } as unknown as ReturnType<typeof checkRateLimit>);
    authorized();
  });

  it('never lets the client supply the tenant or actor — only the product and file', async () => {
    vi.mocked(uploadSellerProductMedia).mockResolvedValue({
      ok: true,
      media: {
        id: 'media-1',
        sourceUrl: 'https://x.public.blob.vercel-storage.com/a.jpg',
        contentType: 'image/jpeg',
        byteSize: 3,
      },
    });

    await uploadSellerMediaAction(VALID_FORM_DATA());

    expect(uploadSellerProductMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT_ID,
        sellerAccountId: 'seller-1',
        actorId: 'user-1',
      }),
    );
  });

  it('revalidates the catalogue listing on success', async () => {
    vi.mocked(uploadSellerProductMedia).mockResolvedValue({
      ok: true,
      media: {
        id: 'media-1',
        sourceUrl: 'https://x.public.blob.vercel-storage.com/a.jpg',
        contentType: 'image/jpeg',
        byteSize: 3,
      },
    });

    const result = await uploadSellerMediaAction(VALID_FORM_DATA());

    expect(result).toEqual({
      ok: true,
      media: {
        id: 'media-1',
        sourceUrl: 'https://x.public.blob.vercel-storage.com/a.jpg',
        contentType: 'image/jpeg',
        byteSize: 3,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/listings');
  });

  it('does not revalidate when the domain module refuses', async () => {
    vi.mocked(uploadSellerProductMedia).mockResolvedValue({
      ok: false,
      reason: 'FILE_TOO_LARGE',
      maxBytes: 8 * 1024 * 1024,
    });

    const result = await uploadSellerMediaAction(VALID_FORM_DATA());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('FILE_TOO_LARGE');
    expect(result.message.length).toBeGreaterThan(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses a missing or malformed productId without calling the domain module', async () => {
    const result = await uploadSellerMediaAction(
      formDataWith({ productId: 'not-a-uuid', file: realFile() }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid_input');
    expect(uploadSellerProductMedia).not.toHaveBeenCalled();
  });

  it('refuses a request with no file field, rather than reading a hand-crafted value as one', async () => {
    const result = await uploadSellerMediaAction(
      formDataWith({ productId: PRODUCT_ID }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid_input');
    expect(uploadSellerProductMedia).not.toHaveBeenCalled();
  });

  it('refuses a non-file value sent under the file field', async () => {
    const formData = formDataWith({ productId: PRODUCT_ID });

    formData.set('file', 'not-a-real-file');

    const result = await uploadSellerMediaAction(formData);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid_input');
    expect(uploadSellerProductMedia).not.toHaveBeenCalled();
  });

  it('denies a caller without product:edit', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new PermissionError());

    const result = await uploadSellerMediaAction(VALID_FORM_DATA());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(uploadSellerProductMedia).not.toHaveBeenCalled();
  });

  it('denies a seller whose business model is not DROPSHIPPER', async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      sellerId: 'seller-1',
      userId: 'user-1',
      role: 'seller_manager',
      sellerBusinessModel: 'OWN_STOCK',
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);

    const result = await uploadSellerMediaAction(VALID_FORM_DATA());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(uploadSellerProductMedia).not.toHaveBeenCalled();
  });

  it('reports an unconfigured database instead of attempting an upload', async () => {
    vi.mocked(isDatabaseConfigured).mockReturnValue(false);

    const result = await uploadSellerMediaAction(VALID_FORM_DATA());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('not_configured');
    expect(uploadSellerProductMedia).not.toHaveBeenCalled();
  });

  it('reports a rate limit before reaching the domain module', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMs: 1000,
    } as unknown as ReturnType<typeof checkRateLimit>);

    const result = await uploadSellerMediaAction(VALID_FORM_DATA());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('rate_limited');
    expect(uploadSellerProductMedia).not.toHaveBeenCalled();
  });
});
