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
  updateTag: vi.fn(),
}));

vi.mock('@/modules/catalog/products/save-category-attributes', () => ({
  default: vi.fn(),
}));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import saveCategoryAttributes from '@/modules/catalog/products/save-category-attributes';
import { revalidatePath } from 'next/cache';

import saveCategoryAttributesAction from './category-attributes-actions';
/* eslint-enable import/first */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const VALID_INPUT = {
  productId: PRODUCT_ID,
  expectedProductVersion: 1,
  attributes: { Brand: ['Royal Canin'] },
};

const VALID_RESULT = {
  ok: true as const,
  productVersion: 2,
  validation: {
    outcome: 'VALID' as const,
    categoryCode: 'CAT-GGL-1',
    controlsVersion: 'sals3-attribute-controls-v1',
    acceptedAttributes: {
      Brand: { values: ['Royal Canin'], isCustomValue: false },
    },
    missingRequiredAttributes: [],
    missingRecommendedAttributes: [],
    unrecognizedAttributes: [],
    findings: [],
    contractVersion: 'category-attribute-contract-v1',
  },
};

function authorized() {
  vi.mocked(requirePermission).mockResolvedValue({
    sellerId: 'seller-1',
    userId: 'user-1',
    sellerBusinessModel: 'DROPSHIPPER',
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
}

describe('saveCategoryAttributesAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDatabaseConfigured).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    } as unknown as ReturnType<typeof checkRateLimit>);
    authorized();
  });

  it('revalidates listings on success', async () => {
    vi.mocked(saveCategoryAttributes).mockResolvedValue(VALID_RESULT);

    const result = await saveCategoryAttributesAction(VALID_INPUT);

    expect(result).toEqual(VALID_RESULT);
    expect(revalidatePath).toHaveBeenCalledWith('/listings', 'layout');
  });

  it('does not revalidate when the domain module refuses', async () => {
    vi.mocked(saveCategoryAttributes).mockResolvedValue({
      ok: false,
      reason: 'NO_CATEGORY_ASSIGNED',
    });

    const result = await saveCategoryAttributesAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('NO_CATEGORY_ASSIGNED');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('gives every domain refusal a message, never an empty string', async () => {
    const reasons = [
      'not_found',
      'version_conflict',
      'NO_CATEGORY_ASSIGNED',
      'ATTRIBUTE_CONTROLS_UNAVAILABLE',
    ] as const;

    // eslint-disable-next-line no-restricted-syntax
    for (const reason of reasons) {
      vi.mocked(saveCategoryAttributes).mockResolvedValue({
        ok: false,
        reason,
      });

      // eslint-disable-next-line no-await-in-loop
      const result = await saveCategoryAttributesAction(VALID_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected a refusal');
      expect(result.reason).toBe(reason);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('refuses input the schema cannot read without calling the writer', async () => {
    const result = await saveCategoryAttributesAction({
      productId: 'not-a-uuid',
      expectedProductVersion: 1,
      attributes: {},
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid_input');
    expect(saveCategoryAttributes).not.toHaveBeenCalled();
  });

  it('refuses a non-array attribute value at the schema boundary', async () => {
    const result = await saveCategoryAttributesAction({
      ...VALID_INPUT,
      attributes: { Brand: 'Royal Canin' },
    });

    expect(result.ok).toBe(false);
    expect(saveCategoryAttributes).not.toHaveBeenCalled();
  });

  it('never lets the client choose the tenant or the actor', async () => {
    vi.mocked(saveCategoryAttributes).mockResolvedValue(VALID_RESULT);

    await saveCategoryAttributesAction({
      ...VALID_INPUT,
      sellerAccountId: 'attacker-seller',
      actorId: 'attacker-user',
    });

    expect(saveCategoryAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerAccountId: 'seller-1',
        actorId: 'user-1',
      }),
    );
  });

  it('denies a seller whose business model is not DROPSHIPPER', async () => {
    vi.mocked(requirePermission).mockResolvedValue({
      sellerId: 'seller-1',
      userId: 'user-1',
      sellerBusinessModel: 'OWN_STOCK',
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);

    const result = await saveCategoryAttributesAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(saveCategoryAttributes).not.toHaveBeenCalled();
  });

  it('denies a caller without product:edit', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new PermissionError());

    const result = await saveCategoryAttributesAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
  });

  it('reports an unconfigured database instead of attempting a write', async () => {
    vi.mocked(isDatabaseConfigured).mockReturnValue(false);

    const result = await saveCategoryAttributesAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('not_configured');
    expect(saveCategoryAttributes).not.toHaveBeenCalled();
  });

  it('reports a rate limit before reaching the writer', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMs: 1000,
    } as unknown as ReturnType<typeof checkRateLimit>);

    const result = await saveCategoryAttributesAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('rate_limited');
    expect(saveCategoryAttributes).not.toHaveBeenCalled();
  });
});
