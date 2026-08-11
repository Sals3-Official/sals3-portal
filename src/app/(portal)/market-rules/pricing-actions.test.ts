import { beforeEach, describe, expect, it, vi } from 'vitest';

const TX = { __tx: true } as const;

const { getDbMock, transactionMock } = vi.hoisted(() => {
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ __tx: true }),
  );

  return {
    transactionMock: transaction,
    getDbMock: vi.fn(() => ({ __pool: true, transaction })),
  };
});

vi.mock('@/lib/db/client', () => ({ default: getDbMock }));

const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requirePermission: requirePermissionMock,
}));

const { checkRateLimitMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(() => ({ allowed: true })),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: checkRateLimitMock }));

const { candidateBelongsToSellerMock, appendAuditEventMock } = vi.hoisted(
  () => ({
    candidateBelongsToSellerMock: vi.fn(),
    appendAuditEventMock: vi.fn(),
  }),
);

vi.mock('@/modules/catalog/candidates/repository', () => ({
  candidateBelongsToSeller: candidateBelongsToSellerMock,
  appendAuditEvent: appendAuditEventMock,
}));

const pricingRepositoryMocks = vi.hoisted(() => ({
  findCategoryByCode: vi.fn(),
  findActiveCategoryPolicy: vi.fn(),
  createCategoryPolicy: vi.fn(),
  reviseCategoryPolicy: vi.fn(),
  deactivateCategoryPolicy: vi.fn(),
  findActiveFxAdjustmentPolicy: vi.fn(),
  createFxAdjustmentPolicy: vi.fn(),
  reviseFxAdjustmentPolicy: vi.fn(),
  deactivateFxAdjustmentPolicy: vi.fn(),
  findActiveProductOverride: vi.fn(),
  createProductOverride: vi.fn(),
  removeProductOverride: vi.fn(),
  findActiveVariantOverride: vi.fn(),
  createVariantOverride: vi.fn(),
  removeVariantOverride: vi.fn(),
  searchCategories: vi.fn(),
}));

vi.mock('@/modules/pricing/repository', () => pricingRepositoryMocks);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import {
  deactivateCategoryPolicyAction,
  removeProductOverrideAction,
  saveCategoryPolicyAction,
  saveProductOverrideAction,
} from './pricing-actions';

const SELLER_A_ID = '11111111-1111-4111-a111-111111111111';
const SELLER_B_ID = '22222222-2222-4222-a222-222222222222';
const POLICY_ID = '33333333-3333-4333-a333-333333333333';
const CANDIDATE_ID = '44444444-4444-4444-a444-444444444444';
const OVERRIDE_ID = '55555555-5555-4555-a555-555555555555';

const SESSION = { sellerId: SELLER_A_ID, userId: 'user-1' };

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(
    async (callback: (tx: unknown) => unknown) => callback(TX),
  );
  requirePermissionMock.mockResolvedValue(SESSION);
  checkRateLimitMock.mockReturnValue({ allowed: true });
});

describe('saveCategoryPolicyAction', () => {
  const VALID_INPUT = {
    categoryCode: 'CAT-DIG-100801',
    targetMarginRate: '0.30',
    roundingRule: 'NONE',
    reason: 'Standard department default for this launch category.',
  };

  it('denies a caller without pricing_policy:manage', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError());

    const result = await saveCategoryPolicyAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(pricingRepositoryMocks.findCategoryByCode).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range margin rate before touching the database', async () => {
    const result = await saveCategoryPolicyAction({
      ...VALID_INPUT,
      targetMarginRate: '1.5',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_input' });
    expect(requirePermissionMock).not.toHaveBeenCalled();
  });

  it('rejects a reason that is too short to be a real explanation', async () => {
    const result = await saveCategoryPolicyAction({
      ...VALID_INPUT,
      reason: 'why',
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_input' });
  });

  it('rate-limits repeated calls', async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false });

    const result = await saveCategoryPolicyAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('creates a new version-1 policy and audits it when none is active yet', async () => {
    pricingRepositoryMocks.findCategoryByCode.mockResolvedValue({
      id: 'category-1',
      code: 'CAT-DIG-100801',
    });
    pricingRepositoryMocks.findActiveCategoryPolicy.mockResolvedValue(null);
    pricingRepositoryMocks.createCategoryPolicy.mockResolvedValue({
      id: 'policy-1',
      version: 1,
      supersedesId: null,
    });

    const result = await saveCategoryPolicyAction(VALID_INPUT);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.createCategoryPolicy).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        sellerAccountId: SELLER_A_ID,
        categoryId: 'category-1',
        actorId: 'user-1',
      }),
    );
    expect(pricingRepositoryMocks.reviseCategoryPolicy).not.toHaveBeenCalled();
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        actorId: 'user-1',
        action: 'category_pricing_policy.created',
        entityType: 'PricingCategoryPolicy',
        entityId: 'policy-1',
      }),
    );
  });

  it('revises (supersedes) the existing active policy instead of creating a duplicate', async () => {
    const existing = {
      id: 'policy-1',
      version: 2,
      sellerAccountId: 'seller-1',
      categoryId: 'category-1',
    };
    pricingRepositoryMocks.findCategoryByCode.mockResolvedValue({
      id: 'category-1',
      code: 'CAT-DIG-100801',
    });
    pricingRepositoryMocks.findActiveCategoryPolicy.mockResolvedValue(existing);
    pricingRepositoryMocks.reviseCategoryPolicy.mockResolvedValue({
      id: 'policy-2',
      version: 3,
      supersedesId: 'policy-1',
    });

    const result = await saveCategoryPolicyAction(VALID_INPUT);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.reviseCategoryPolicy).toHaveBeenCalledWith(
      TX,
      existing,
      expect.any(Object),
    );
    expect(pricingRepositoryMocks.createCategoryPolicy).not.toHaveBeenCalled();
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'category_pricing_policy.revised' }),
    );
  });

  it('returns not_found for an unknown category code', async () => {
    pricingRepositoryMocks.findCategoryByCode.mockResolvedValue(null);

    const result = await saveCategoryPolicyAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('deactivateCategoryPolicyAction', () => {
  it('refuses to deactivate a policy claimed to belong to a different seller (IDOR guard)', async () => {
    const result = await deactivateCategoryPolicyAction(POLICY_ID, SELLER_B_ID);

    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(
      pricingRepositoryMocks.deactivateCategoryPolicy,
    ).not.toHaveBeenCalled();
  });

  it('deactivates and audits when the seller id matches the caller', async () => {
    const result = await deactivateCategoryPolicyAction(POLICY_ID, SELLER_A_ID);

    expect(result).toEqual({ ok: true });
    expect(
      pricingRepositoryMocks.deactivateCategoryPolicy,
    ).toHaveBeenCalledWith(TX, POLICY_ID);
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'category_pricing_policy.deactivated',
      }),
    );
  });
});

describe('saveProductOverrideAction — tenant isolation', () => {
  const VALID_INPUT = {
    supplierCandidateId: CANDIDATE_ID,
    targetMarginRate: '0.45',
    reason: 'This candidate carries materially higher return risk.',
  };

  it("refuses to create an override on a candidate that does not belong to the caller's seller account", async () => {
    candidateBelongsToSellerMock.mockResolvedValue(false);

    const result = await saveProductOverrideAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(pricingRepositoryMocks.createProductOverride).not.toHaveBeenCalled();
    expect(candidateBelongsToSellerMock).toHaveBeenCalledWith(
      expect.anything(),
      VALID_INPUT.supplierCandidateId,
      SELLER_A_ID,
    );
  });

  it('creates the override when the candidate belongs to the caller', async () => {
    candidateBelongsToSellerMock.mockResolvedValue(true);
    pricingRepositoryMocks.findActiveProductOverride.mockResolvedValue(null);
    pricingRepositoryMocks.createProductOverride.mockResolvedValue({
      id: OVERRIDE_ID,
    });

    const result = await saveProductOverrideAction(VALID_INPUT);

    expect(result).toEqual({ ok: true });
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'product_pricing_override.created',
        entityId: OVERRIDE_ID,
      }),
    );
  });
});

describe('removeProductOverrideAction — tenant isolation', () => {
  it('refuses to remove an override for a candidate outside the caller tenant', async () => {
    candidateBelongsToSellerMock.mockResolvedValue(false);

    const result = await removeProductOverrideAction(OVERRIDE_ID, CANDIDATE_ID);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(pricingRepositoryMocks.removeProductOverride).not.toHaveBeenCalled();
  });

  it('reverts to the category policy and records an explainable audit event', async () => {
    candidateBelongsToSellerMock.mockResolvedValue(true);

    const result = await removeProductOverrideAction(OVERRIDE_ID, CANDIDATE_ID);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.removeProductOverride).toHaveBeenCalledWith(
      TX,
      OVERRIDE_ID,
    );
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        actorId: 'user-1',
        action: 'product_pricing_override.removed',
        entityType: 'PricingProductOverride',
        entityId: OVERRIDE_ID,
        payload: expect.objectContaining({
          sellerAccountId: SELLER_A_ID,
          supplierCandidateId: CANDIDATE_ID,
        }),
      }),
    );
  });
});
