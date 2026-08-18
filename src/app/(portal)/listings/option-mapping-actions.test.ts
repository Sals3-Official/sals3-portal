// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `catalog-cache` begins with `import 'server-only'`, which refuses under the
 * test runner regardless of the declared environment — so the module is mocked
 * rather than imported. Everything real in it (a `unstable_cache` wrapper around
 * the storefront reads) is irrelevant to this action; only the tag name matters.
 *
 * The literal is duplicated here as a result. It is asserted against the value in
 * `src/lib/storefront/catalog-cache.ts`, so if that constant is ever renamed this
 * mock must move with it.
 */
vi.mock('@/lib/storefront/catalog-cache', () => ({
  // Inlined, not a reference to the const below: `vi.mock` is hoisted above every
  // top-level declaration, so naming one here throws before any test runs.
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

vi.mock('@/modules/catalog/products/rename-option-mapping', () => ({
  default: vi.fn(),
}));

vi.mock('@/modules/catalog/products/save-option-mapping', () => ({
  default: vi.fn(),
}));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import saveOptionMapping from '@/modules/catalog/products/save-option-mapping';
import { revalidatePath, updateTag } from 'next/cache';

import saveOptionMappingAction from './option-mapping-actions';
/* eslint-enable import/first */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const VALID_INPUT = {
  productId: PRODUCT_ID,
  expectedProductVersion: 1,
  axes: [
    {
      name: 'Colour',
      values: [
        { raw: 'Black', label: 'Black' },
        { raw: 'Army Green', label: 'Army Green' },
      ],
    },
  ],
};

function authorized() {
  vi.mocked(requirePermission).mockResolvedValue({
    sellerId: 'seller-1',
    userId: 'user-1',
    sellerBusinessModel: 'DROPSHIPPER',
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);
}

/**
 * A unique violation shaped the way Drizzle actually throws it.
 *
 * The driver error is hung off `cause`, and the constraint name appears only in
 * `cause.constraint_name` — never in the wrapper's `message`, because an INSERT
 * does not name its own indexes. A translation that substring-matched the message
 * would find nothing here, which is the whole point of this fixture.
 */
function wrappedUniqueViolation(constraintName: string): Error {
  const driverError = Object.assign(
    new Error('duplicate key value violates unique constraint'),
    { code: '23505', constraint_name: constraintName },
  );

  return Object.assign(new Error('Failed query: insert into ...'), {
    cause: driverError,
  });
}

describe('saveOptionMappingAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDatabaseConfigured).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    } as unknown as ReturnType<typeof checkRateLimit>);
    authorized();
  });

  it('translates the combination unique violation into a sentence', async () => {
    vi.mocked(saveOptionMapping).mockRejectedValue(
      wrappedUniqueViolation('product_variants_active_combination_key'),
    );

    const result = await saveOptionMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('duplicate_combination');
    expect(result.message).toMatch(/same combination of option values/);
    // Never the raw database identifier.
    expect(result.message).not.toContain('product_variants_active');
  });

  it('rethrows a unique violation on a constraint it does not own', async () => {
    vi.mocked(saveOptionMapping).mockRejectedValue(
      wrappedUniqueViolation('products_public_slug_key'),
    );

    await expect(saveOptionMappingAction(VALID_INPUT)).rejects.toThrow();
  });

  it('expires the storefront cache on success, not only the listings path', async () => {
    vi.mocked(saveOptionMapping).mockResolvedValue({
      ok: true,
      axisCount: 1,
      mappedVariantCount: 10,
    });

    const result = await saveOptionMappingAction(VALID_INPUT);

    expect(result).toEqual({ ok: true, axisCount: 1, mappedVariantCount: 10 });
    expect(revalidatePath).toHaveBeenCalledWith('/listings');
    // A mapped product renders different axes on its PDP, so a live product's
    // cached payload must not survive the save.
    expect(updateTag).toHaveBeenCalledWith(CATALOG_TAG);
  });

  it('does not touch either cache when the domain module refuses', async () => {
    vi.mocked(saveOptionMapping).mockResolvedValue({
      ok: false,
      reason: 'ALREADY_MAPPED',
    });

    const result = await saveOptionMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('ALREADY_MAPPED');
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('gives every domain refusal a message, never an empty string', async () => {
    const reasons = [
      'not_found',
      'version_conflict',
      'ALREADY_MAPPED',
      'SPLIT_NOT_DERIVABLE',
      'SHAPE_MISMATCH',
    ] as const;

    // eslint-disable-next-line no-restricted-syntax
    for (const reason of reasons) {
      vi.mocked(saveOptionMapping).mockResolvedValue({ ok: false, reason });

      // eslint-disable-next-line no-await-in-loop
      const result = await saveOptionMappingAction(VALID_INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected a refusal');
      expect(result.reason).toBe(reason);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('refuses input the schema cannot read without calling the writer', async () => {
    const result = await saveOptionMappingAction({
      productId: 'not-a-uuid',
      expectedProductVersion: 1,
      axes: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('invalid_input');
    expect(saveOptionMapping).not.toHaveBeenCalled();
  });

  it('refuses an axis with fewer than two values', async () => {
    const result = await saveOptionMappingAction({
      ...VALID_INPUT,
      axes: [{ name: 'Colour', values: [{ raw: 'Black', label: 'Black' }] }],
    });

    expect(result.ok).toBe(false);
    expect(saveOptionMapping).not.toHaveBeenCalled();
  });

  it('refuses an unnamed axis', async () => {
    const result = await saveOptionMappingAction({
      ...VALID_INPUT,
      axes: [{ ...VALID_INPUT.axes[0], name: '   ' }],
    });

    expect(result.ok).toBe(false);
    expect(saveOptionMapping).not.toHaveBeenCalled();
  });

  it('never lets the client choose the tenant or the actor', async () => {
    vi.mocked(saveOptionMapping).mockResolvedValue({
      ok: true,
      axisCount: 1,
      mappedVariantCount: 2,
    });

    await saveOptionMappingAction({
      ...VALID_INPUT,
      sellerAccountId: 'attacker-seller',
      actorId: 'attacker-user',
    });

    expect(saveOptionMapping).toHaveBeenCalledWith(
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

    const result = await saveOptionMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
    expect(saveOptionMapping).not.toHaveBeenCalled();
  });

  it('denies a caller without product:edit', async () => {
    vi.mocked(requirePermission).mockRejectedValue(new PermissionError());

    const result = await saveOptionMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('denied');
  });

  it('reports an unconfigured database instead of attempting a write', async () => {
    vi.mocked(isDatabaseConfigured).mockReturnValue(false);

    const result = await saveOptionMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('not_configured');
    expect(saveOptionMapping).not.toHaveBeenCalled();
  });

  it('reports a rate limit before reaching the writer', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfterMs: 1000,
    } as unknown as ReturnType<typeof checkRateLimit>);

    const result = await saveOptionMappingAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('rate_limited');
    expect(saveOptionMapping).not.toHaveBeenCalled();
  });
});
