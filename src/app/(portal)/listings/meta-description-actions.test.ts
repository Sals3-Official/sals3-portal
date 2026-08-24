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

vi.mock('@/modules/catalog/products/save-meta-description', () => ({
  default: vi.fn(),
}));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import saveMetaDescription from '@/modules/catalog/products/save-meta-description';
import { revalidatePath } from 'next/cache';

import saveMetaDescriptionAction from './meta-description-actions';
/* eslint-enable import/first */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const VALID_INPUT = {
  productId: PRODUCT_ID,
  expectedProductVersion: 1,
  metaDescription: 'Waterproof packable daypack with a hidden laptop sleeve.',
};

function authorized() {
  vi.mocked(requirePermission).mockResolvedValue({
    sellerId: 'seller-1',
    userId: 'user-1',
    role: 'seller_manager',
    sellerBusinessModel: 'DROPSHIPPER',
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
}

describe('saveMetaDescriptionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDatabaseConfigured).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    } as unknown as ReturnType<typeof checkRateLimit>);
    authorized();
  });

  it('never lets the client supply the tenant or actor — only the product and copy', async () => {
    vi.mocked(saveMetaDescription).mockResolvedValue({
      ok: true,
      productVersion: 2,
    });

    await saveMetaDescriptionAction({
      ...VALID_INPUT,
      sellerAccountId: 'attacker-seller',
      actorId: 'attacker-user',
    });

    expect(saveMetaDescription).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT_ID,
        sellerAccountId: 'seller-1',
        actorId: 'user-1',
        metaDescription: VALID_INPUT.metaDescription,
      }),
    );
  });

  it('stores `null`, not an empty string, when the seller clears the field', async () => {
    vi.mocked(saveMetaDescription).mockResolvedValue({
      ok: true,
      productVersion: 2,
    });

    await saveMetaDescriptionAction({ ...VALID_INPUT, metaDescription: '' });

    expect(saveMetaDescription).toHaveBeenCalledWith(
      expect.objectContaining({ metaDescription: null }),
    );
  });

  it('revalidates the catalogue listing on success', async () => {
    vi.mocked(saveMetaDescription).mockResolvedValue({
      ok: true,
      productVersion: 2,
    });

    const result = await saveMetaDescriptionAction(VALID_INPUT);

    expect(result).toEqual({ ok: true, productVersion: 2 });
    expect(revalidatePath).toHaveBeenCalledWith('/listings', 'layout');
  });

  it('does not revalidate when the domain module refuses', async () => {
    vi.mocked(saveMetaDescription).mockResolvedValue({
      ok: false,
      reason: 'version_conflict',
    });

    const result = await saveMetaDescriptionAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('version_conflict');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses copy over the server cap without calling the domain module', async () => {
    const result = await saveMetaDescriptionAction({
      ...VALID_INPUT,
      metaDescription: 'x'.repeat(321),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid_input');
    expect(saveMetaDescription).not.toHaveBeenCalled();
  });

  it('refuses input the schema cannot read without calling the domain module', async () => {
    const result = await saveMetaDescriptionAction({
      productId: 'not-a-uuid',
      expectedProductVersion: 1,
      metaDescription: 'fine copy',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid_input');
    expect(saveMetaDescription).not.toHaveBeenCalled();
  });

  it('denies a caller without product:edit', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new PermissionError());

    const result = await saveMetaDescriptionAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(saveMetaDescription).not.toHaveBeenCalled();
  });

  it('denies a seller whose business model is not DROPSHIPPER', async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      sellerId: 'seller-1',
      userId: 'user-1',
      role: 'seller_manager',
      sellerBusinessModel: 'OWN_STOCK',
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);

    const result = await saveMetaDescriptionAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(saveMetaDescription).not.toHaveBeenCalled();
  });

  it('reports an unconfigured database instead of attempting a write', async () => {
    vi.mocked(isDatabaseConfigured).mockReturnValue(false);

    const result = await saveMetaDescriptionAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('not_configured');
    expect(saveMetaDescription).not.toHaveBeenCalled();
  });

  it('reports a rate limit before reaching the domain module', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMs: 1000,
    } as unknown as ReturnType<typeof checkRateLimit>);

    const result = await saveMetaDescriptionAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('rate_limited');
    expect(saveMetaDescription).not.toHaveBeenCalled();
  });
});
