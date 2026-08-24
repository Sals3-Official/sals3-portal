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

vi.mock('@/modules/catalog/products/assign-variant-media', () => ({
  default: vi.fn(),
}));

/* eslint-disable import/first */
import { revalidatePath } from 'next/cache';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import assignVariantMedia from '@/modules/catalog/products/assign-variant-media';

import assignVariantMediaAction from './variant-media-actions';
/* eslint-enable import/first */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const MEDIA_ID = '22222222-2222-4222-8222-222222222222';
const VARIANT_ID = '33333333-3333-4333-8333-333333333333';

function authorized() {
  vi.mocked(requirePermission).mockResolvedValue({
    sellerId: 'seller-1',
    userId: 'user-1',
    role: 'seller_manager',
    sellerBusinessModel: 'DROPSHIPPER',
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
}

describe('assignVariantMediaAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDatabaseConfigured).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    } as unknown as ReturnType<typeof checkRateLimit>);
    authorized();
  });

  it('never lets the client supply the tenant or actor', async () => {
    vi.mocked(assignVariantMedia).mockResolvedValue({
      ok: true,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
    });

    await assignVariantMediaAction({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
      // Ignored: the session decides both, so a crafted payload carries no
      // identity to escalate with.
      sellerAccountId: 'seller-2',
      actorId: 'user-2',
    });

    expect(assignVariantMedia).toHaveBeenCalledWith({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
      sellerAccountId: 'seller-1',
      actorId: 'user-1',
    });
  });

  it('accepts a null variant, which returns the photo to product level', async () => {
    vi.mocked(assignVariantMedia).mockResolvedValue({
      ok: true,
      mediaId: MEDIA_ID,
      variantId: null,
    });

    const result = await assignVariantMediaAction({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      variantId: null,
    });

    expect(result).toEqual({ ok: true, mediaId: MEDIA_ID, variantId: null });
  });

  it('invalidates the editor route the seller is standing on, not just /listings', async () => {
    vi.mocked(assignVariantMedia).mockResolvedValue({
      ok: true,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
    });

    await assignVariantMediaAction({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
    });

    /**
     * The whole bug, in one assertion.
     *
     * This action used to call `revalidatePath('/listings')`, and the Product
     * Editor is `/listings/new?productId=…`. The write reached Postgres, the
     * seller saw the thumbnail from local state, then `router.refresh()`
     * re-requested a route nothing had invalidated and the stale projection put
     * the placeholder back. The photo "disappeared" while being saved correctly.
     *
     * `'layout'` is what makes the subtree — `/listings/new` and the description
     * studio included — part of the invalidation. Asserted with the argument,
     * because `toHaveBeenCalledWith('/listings')` passes for the broken call and
     * is exactly the assertion that let this ship.
     */
    expect(revalidatePath).toHaveBeenCalledWith('/listings', 'layout');
  });

  it('refuses an id that is not a uuid without reaching the database', async () => {
    const result = await assignVariantMediaAction({
      productId: PRODUCT_ID,
      mediaId: 'not-a-uuid',
      variantId: VARIANT_ID,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid_input' }),
    );
    expect(assignVariantMedia).not.toHaveBeenCalled();
  });

  it('refuses a caller without product:edit', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new PermissionError());

    const result = await assignVariantMediaAction({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'denied' }),
    );
    expect(assignVariantMedia).not.toHaveBeenCalled();
  });

  it('refuses a seller who is not a Dropshipper (ADR-006)', async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      sellerId: 'seller-1',
      userId: 'user-1',
      role: 'seller_manager',
      sellerBusinessModel: 'RETAILER',
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);

    const result = await assignVariantMediaAction({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'denied' }),
    );
    expect(assignVariantMedia).not.toHaveBeenCalled();
  });

  it('rate-limits per seller', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMs: 1_000,
    } as unknown as ReturnType<typeof checkRateLimit>);

    const result = await assignVariantMediaAction({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'rate_limited' }),
    );
    expect(assignVariantMedia).not.toHaveBeenCalled();
  });

  it('reports a domain refusal in the seller’s own terms', async () => {
    vi.mocked(assignVariantMedia).mockResolvedValue({
      ok: false,
      reason: 'MEDIA_NOT_FOUND',
    });

    const result = await assignVariantMediaAction({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      variantId: VARIANT_ID,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'MEDIA_NOT_FOUND',
      message: expect.stringContaining('no longer stored'),
    });
  });
});
