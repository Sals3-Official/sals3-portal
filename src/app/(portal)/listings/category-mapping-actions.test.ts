// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storefront/catalog-cache', () => ({
  STOREFRONT_CATALOG_TAG: 'storefront-catalog',
}));

const CATALOG_TAG = 'storefront-catalog';

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
  updateTag: vi.fn(),
}));

vi.mock('@/modules/catalog/taxonomy/authorization', () => ({
  authorizeCategoryGovernance: vi.fn(),
}));

vi.mock('@/modules/catalog/products/decide-category', () => ({
  decideProductSals3Category: vi.fn(),
}));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { authorizeCategoryGovernance } from '@/modules/catalog/taxonomy/authorization';
import { decideProductSals3Category } from '@/modules/catalog/products/decide-category';
import { revalidatePath, updateTag } from 'next/cache';

import { decideCategoryMappingAction } from './category-mapping-actions';
/* eslint-enable import/first */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const VALID_INPUT = {
  productId: PRODUCT_ID,
  expectedProductVersion: 1,
  sals3CategoryCode: 'CAT-GGL-100230',
  reason: 'This is a real jacket category, not a mirrored passthrough.',
};

function authorized() {
  vi.mocked(requirePermission).mockResolvedValue({
    sellerId: 'seller-1',
    userId: 'user-1',
    role: 'seller_manager',
    sellerBusinessModel: 'DROPSHIPPER',
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
  vi.mocked(authorizeCategoryGovernance).mockReturnValue({
    allowed: true,
    role: 'seller_manager',
  } as unknown as ReturnType<typeof authorizeCategoryGovernance>);
}

describe('decideCategoryMappingAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDatabaseConfigured).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    } as unknown as ReturnType<typeof checkRateLimit>);
    authorized();
  });

  it('never lets the client supply an externalCategoryId or the tenant/actor — only what a person decided', async () => {
    vi.mocked(decideProductSals3Category).mockResolvedValue({
      ok: true,
      categoryCode: 'CAT-GGL-100230',
      categoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
      productVersion: 2,
    });

    await decideCategoryMappingAction({
      ...VALID_INPUT,
      // Anything beyond the schema's fields is simply not read.
      externalCategoryId: 'attacker-supplied-category',
      sellerAccountId: 'attacker-seller',
      actorId: 'attacker-user',
    });

    expect(decideProductSals3Category).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT_ID,
        sellerAccountId: 'seller-1',
        actorId: 'user-1',
        sals3CategoryCode: 'CAT-GGL-100230',
      }),
    );
    const call = vi.mocked(decideProductSals3Category).mock.calls[0]?.[0];
    expect(call).not.toHaveProperty('externalCategoryId');
  });

  it('expires the storefront cache on success, not only the listings path', async () => {
    vi.mocked(decideProductSals3Category).mockResolvedValue({
      ok: true,
      categoryCode: 'CAT-GGL-100230',
      categoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
      productVersion: 2,
    });

    const result = await decideCategoryMappingAction(VALID_INPUT);

    expect(result).toEqual({
      ok: true,
      categoryCode: 'CAT-GGL-100230',
      categoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/listings');
    expect(updateTag).toHaveBeenCalledWith(CATALOG_TAG);
  });

  it('does not touch either cache when the domain module refuses', async () => {
    vi.mocked(decideProductSals3Category).mockResolvedValue({
      ok: false,
      reason: 'NO_SUPPLIER_CATEGORY',
    });

    const result = await decideCategoryMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('NO_SUPPLIER_CATEGORY');
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('gives every domain refusal a message, never an empty string', async () => {
    const reasons = [
      'NOT_FOUND',
      'NO_SUPPLIER_CATEGORY',
      'UNKNOWN_SALS3_CATEGORY',
      'STALE_WRITE',
    ] as const;

    // eslint-disable-next-line no-restricted-syntax
    for (const reason of reasons) {
      vi.mocked(decideProductSals3Category).mockResolvedValue({
        ok: false,
        reason,
      } as never);

      // eslint-disable-next-line no-await-in-loop
      const result = await decideCategoryMappingAction(VALID_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected a refusal');
      expect(result.reason).toBe(reason);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('refuses input the schema cannot read without calling the domain module', async () => {
    const result = await decideCategoryMappingAction({
      productId: 'not-a-uuid',
      expectedProductVersion: 1,
      sals3CategoryCode: 'CAT-GGL-100230',
      reason: 'short',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid_input');
    expect(decideProductSals3Category).not.toHaveBeenCalled();
  });

  it('refuses a reason under 8 characters', async () => {
    const result = await decideCategoryMappingAction({
      ...VALID_INPUT,
      reason: 'short',
    });

    expect(result.ok).toBe(false);
    expect(decideProductSals3Category).not.toHaveBeenCalled();
  });

  it('denies a caller without product:edit', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new PermissionError());

    const result = await decideCategoryMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(decideProductSals3Category).not.toHaveBeenCalled();
  });

  /**
   * The governance-specific boundary this whole feature is about: a session
   * that passes the ordinary `product:edit` gate must still separately hold
   * category-mapping authority.
   */
  it('denies a caller who can edit products but lacks category-mapping authority', async () => {
    vi.mocked(authorizeCategoryGovernance).mockReturnValue({
      allowed: false,
      reason: 'CATEGORY_GOVERNANCE_AUTHORITY_UNAVAILABLE',
      message: 'You do not have permission to decide a category mapping.',
    } as unknown as ReturnType<typeof authorizeCategoryGovernance>);

    const result = await decideCategoryMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(decideProductSals3Category).not.toHaveBeenCalled();
  });

  it('denies a seller whose business model is not DROPSHIPPER', async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      sellerId: 'seller-1',
      userId: 'user-1',
      role: 'seller_manager',
      sellerBusinessModel: 'OWN_STOCK',
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);

    const result = await decideCategoryMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(decideProductSals3Category).not.toHaveBeenCalled();
  });

  it('reports an unconfigured database instead of attempting a write', async () => {
    vi.mocked(isDatabaseConfigured).mockReturnValue(false);

    const result = await decideCategoryMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('not_configured');
    expect(decideProductSals3Category).not.toHaveBeenCalled();
  });

  it('reports a rate limit before reaching the domain module', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMs: 1000,
    } as unknown as ReturnType<typeof checkRateLimit>);

    const result = await decideCategoryMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('rate_limited');
    expect(decideProductSals3Category).not.toHaveBeenCalled();
  });
});
