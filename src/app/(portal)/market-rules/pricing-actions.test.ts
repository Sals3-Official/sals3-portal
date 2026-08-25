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

const {
  candidateBelongsToSellerMock,
  appendAuditEventMock,
  listAuditHistoryForSellerEntityMock,
} = vi.hoisted(() => ({
  candidateBelongsToSellerMock: vi.fn(),
  appendAuditEventMock: vi.fn(),
  listAuditHistoryForSellerEntityMock: vi.fn(),
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  candidateBelongsToSeller: candidateBelongsToSellerMock,
  appendAuditEvent: appendAuditEventMock,
  listAuditHistoryForSellerEntity: listAuditHistoryForSellerEntityMock,
}));

const pricingRepositoryMocks = vi.hoisted(() => ({
  findCategoryByCode: vi.fn(),
  findActiveCategoryPolicy: vi.fn(),
  createCategoryPolicy: vi.fn(),
  reviseCategoryPolicy: vi.fn(),
  deactivateCategoryPolicy: vi.fn(),
  findCategoryById: vi.fn(),
  findStoreDefaultForScope: vi.fn(),
  findCategoriesByCodes: vi.fn(),
  createStoreDefault: vi.fn(),
  reviseStoreDefault: vi.fn(),
  deactivateStoreDefault: vi.fn(),
  findActiveFundingBufferPolicy: vi.fn(),
  createFundingBufferPolicy: vi.fn(),
  reviseFundingBufferPolicy: vi.fn(),
  deactivateFundingBufferPolicy: vi.fn(),
  findActiveProductOverride: vi.fn(),
  createProductOverride: vi.fn(),
  reviseProductOverride: vi.fn(),
  removeProductOverride: vi.fn(),
  findActiveVariantOverride: vi.fn(),
  createVariantOverride: vi.fn(),
  reviseVariantOverride: vi.fn(),
  removeVariantOverride: vi.fn(),
  searchCategories: vi.fn(),
}));

vi.mock('@/modules/pricing/repository', () => pricingRepositoryMocks);

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/* eslint-disable import/first */
import { PermissionError } from '@/lib/auth/permissions';
import {
  applyMarginCsvAction,
  deactivateCategoryPolicyAction,
  deactivateFundingBufferPolicyAction,
  deactivateStoreDefaultAction,
  getCategoryPolicyHistoryAction,
  getFundingBufferHistoryAction,
  getStoreDefaultHistoryAction,
  removeProductOverrideAction,
  saveCategoryPolicyAction,
  saveFundingBufferPolicyAction,
  saveStoreDefaultAction,
  saveProductOverrideAction,
  saveVariantOverrideAction,
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
    marketCode: null,
  };

  /**
   * The scope is a required field, and this is the case that says so.
   *
   * On 2026-08-25 `marketCode` was added to this schema and the dialog kept
   * sending the previous four-field object. Every save on the category tree
   * returned `invalid_input` and the screen showed only "Check the fields and
   * try again" — in production, on a screen that had worked the day before.
   * Nothing caught it: the action takes `unknown`, so the compiler had nothing
   * to check, and every case in this file already spelled the new field out.
   *
   * A test that only ever passes a complete input cannot fail the way real
   * callers fail. This one passes an incomplete one on purpose.
   */
  it('refuses a payload that never names a destination', async () => {
    const withoutScope: Record<string, unknown> = { ...VALID_INPUT };
    delete withoutScope.marketCode;

    const result = await saveCategoryPolicyAction(withoutScope);

    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
  });

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

    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(requirePermissionMock).not.toHaveBeenCalled();
  });

  it('rejects a reason that is too short to be a real explanation', async () => {
    const result = await saveCategoryPolicyAction({
      ...VALID_INPUT,
      reason: 'why',
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
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

  it('returns not_found when the policy id does not actually belong to this seller in the database — the real IDOR guard, not just the claimed id', async () => {
    pricingRepositoryMocks.deactivateCategoryPolicy.mockResolvedValue(null);

    const result = await deactivateCategoryPolicyAction(POLICY_ID, SELLER_A_ID);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(
      pricingRepositoryMocks.deactivateCategoryPolicy,
    ).toHaveBeenCalledWith(TX, POLICY_ID, SELLER_A_ID);
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it('deactivates and audits when the seller id matches the caller', async () => {
    pricingRepositoryMocks.deactivateCategoryPolicy.mockResolvedValue({
      id: POLICY_ID,
      categoryId: 'category-1',
    });
    pricingRepositoryMocks.findCategoryById.mockResolvedValue({
      id: 'category-1',
      code: 'CAT-DIG-100801',
    });

    const result = await deactivateCategoryPolicyAction(POLICY_ID, SELLER_A_ID);

    expect(result).toEqual({ ok: true });
    expect(
      pricingRepositoryMocks.deactivateCategoryPolicy,
    ).toHaveBeenCalledWith(TX, POLICY_ID, SELLER_A_ID);
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'category_pricing_policy.deactivated',
        payload: expect.objectContaining({ categoryCode: 'CAT-DIG-100801' }),
      }),
    );
  });
});

describe('saveFundingBufferPolicyAction', () => {
  const VALID_INPUT = {
    adjustmentRate: '0.03',
    reason: 'AUD/USD moved against us on the last two CJ Wallet top-ups.',
  };

  it('denies a caller without pricing_policy:manage', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError());

    const result = await saveFundingBufferPolicyAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(
      pricingRepositoryMocks.findActiveFundingBufferPolicy,
    ).not.toHaveBeenCalled();
  });

  it('rejects an out-of-bound adjustment rate before touching the database', async () => {
    const result = await saveFundingBufferPolicyAction({
      ...VALID_INPUT,
      adjustmentRate: '0.5',
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(requirePermissionMock).not.toHaveBeenCalled();
  });

  it('rate-limits repeated calls', async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false });

    const result = await saveFundingBufferPolicyAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('creates a new version-1 buffer and audits it when none is active yet', async () => {
    pricingRepositoryMocks.findActiveFundingBufferPolicy.mockResolvedValue(
      null,
    );
    pricingRepositoryMocks.createFundingBufferPolicy.mockResolvedValue({
      id: 'buffer-1',
      version: 1,
      supersedesId: null,
    });

    const result = await saveFundingBufferPolicyAction(VALID_INPUT);

    // The action hands the written row straight back now, so the card can
    // show it without waiting for a page render — see `savedPolicy`.
    expect(result).toMatchObject({ ok: true });
    expect(result).toMatchObject({
      data: { id: 'buffer-1' },
    });
    expect(
      pricingRepositoryMocks.createFundingBufferPolicy,
    ).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        sellerAccountId: SELLER_A_ID,
        adjustmentRate: '0.03',
        actorId: 'user-1',
      }),
    );
    expect(
      pricingRepositoryMocks.reviseFundingBufferPolicy,
    ).not.toHaveBeenCalled();
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        actorId: 'user-1',
        action: 'funding_buffer_policy.created',
        entityType: 'PricingFxAdjustmentPolicy',
        entityId: 'buffer-1',
      }),
    );
  });

  it('revises (supersedes) the existing active buffer instead of creating a duplicate', async () => {
    const existing = {
      id: 'buffer-1',
      version: 2,
      sellerAccountId: SELLER_A_ID,
    };
    pricingRepositoryMocks.findActiveFundingBufferPolicy.mockResolvedValue(
      existing,
    );
    pricingRepositoryMocks.reviseFundingBufferPolicy.mockResolvedValue({
      id: 'buffer-2',
      version: 3,
      supersedesId: 'buffer-1',
    });

    const result = await saveFundingBufferPolicyAction(VALID_INPUT);

    // The action hands the written row straight back now, so the card can
    // show it without waiting for a page render — see `savedPolicy`.
    expect(result).toMatchObject({ ok: true });
    expect(result).toMatchObject({
      data: { id: 'buffer-2' },
    });
    expect(
      pricingRepositoryMocks.reviseFundingBufferPolicy,
    ).toHaveBeenCalledWith(TX, existing, expect.any(Object));
    expect(
      pricingRepositoryMocks.createFundingBufferPolicy,
    ).not.toHaveBeenCalled();
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'funding_buffer_policy.revised' }),
    );
  });
});

describe('deactivateFundingBufferPolicyAction', () => {
  it('refuses to deactivate a buffer claimed to belong to a different seller (IDOR guard)', async () => {
    const result = await deactivateFundingBufferPolicyAction(
      POLICY_ID,
      SELLER_B_ID,
    );

    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(
      pricingRepositoryMocks.deactivateFundingBufferPolicy,
    ).not.toHaveBeenCalled();
  });

  it('returns not_found when the policy id does not actually belong to this seller in the database', async () => {
    pricingRepositoryMocks.deactivateFundingBufferPolicy.mockResolvedValue(
      null,
    );

    const result = await deactivateFundingBufferPolicyAction(
      POLICY_ID,
      SELLER_A_ID,
    );

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it('deactivates and audits when the seller id matches the caller', async () => {
    pricingRepositoryMocks.deactivateFundingBufferPolicy.mockResolvedValue({
      id: POLICY_ID,
    });

    const result = await deactivateFundingBufferPolicyAction(
      POLICY_ID,
      SELLER_A_ID,
    );

    expect(result).toEqual({ ok: true });
    expect(
      pricingRepositoryMocks.deactivateFundingBufferPolicy,
    ).toHaveBeenCalledWith(TX, POLICY_ID, SELLER_A_ID);
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'funding_buffer_policy.deactivated',
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

/**
 * Editing an override used to mark the row REMOVED and insert a fresh one at
 * version 1, which made an edit indistinguishable from a delete plus an
 * unrelated new record — the version chain the schema promises simply reset.
 * These pin the corrected behaviour: an edit supersedes, continues the chain,
 * and is audited as `revised` rather than `created`.
 */
describe('saveProductOverrideAction — an edit is a revision, not a delete', () => {
  const VALID_INPUT = {
    supplierCandidateId: CANDIDATE_ID,
    targetMarginRate: '0.52',
    reason: 'Return rate rose after the first month of orders.',
  };

  const PREVIOUS = {
    id: OVERRIDE_ID,
    supplierCandidateId: CANDIDATE_ID,
    targetMarginRate: '0.45',
    version: 1,
  };

  beforeEach(() => {
    candidateBelongsToSellerMock.mockResolvedValue(true);
    pricingRepositoryMocks.findActiveProductOverride.mockResolvedValue(
      PREVIOUS,
    );
    pricingRepositoryMocks.reviseProductOverride.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      supplierCandidateId: CANDIDATE_ID,
      version: 2,
      supersedesId: OVERRIDE_ID,
    });
  });

  it('supersedes the previous row instead of removing it', async () => {
    const result = await saveProductOverrideAction(VALID_INPUT);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.reviseProductOverride).toHaveBeenCalledWith(
      TX,
      PREVIOUS,
      {
        targetMarginRate: '0.52',
        reason: VALID_INPUT.reason,
        actorId: 'user-1',
      },
    );
    expect(pricingRepositoryMocks.removeProductOverride).not.toHaveBeenCalled();
    expect(pricingRepositoryMocks.createProductOverride).not.toHaveBeenCalled();
  });

  it('audits the edit as revised, carrying the version chain and the value it replaced', async () => {
    await saveProductOverrideAction(VALID_INPUT);

    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'product_pricing_override.revised',
        entityId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        payload: expect.objectContaining({
          version: 2,
          supersedesId: OVERRIDE_ID,
          previousTargetMarginRate: '0.45',
          targetMarginRate: '0.52',
        }),
      }),
    );
  });

  it('proves ownership inside the same transaction as the write, and writes nothing when it fails', async () => {
    candidateBelongsToSellerMock.mockResolvedValue(false);

    const result = await saveProductOverrideAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(candidateBelongsToSellerMock).toHaveBeenCalledWith(
      TX,
      CANDIDATE_ID,
      SELLER_A_ID,
    );
    expect(pricingRepositoryMocks.reviseProductOverride).not.toHaveBeenCalled();
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });
});

describe('saveVariantOverrideAction — an edit is a revision, not a delete', () => {
  const VALID_INPUT = {
    supplierCandidateId: CANDIDATE_ID,
    supplierVariantId: 'Black-1XL',
    targetMarginRate: '0.60',
    reason: 'This variant ships heavier than the rest of the range.',
    additionalJustification:
      'Freight for the 1XL cut is materially above the others.',
  };

  const PREVIOUS = {
    id: OVERRIDE_ID,
    supplierCandidateId: CANDIDATE_ID,
    supplierVariantId: 'Black-1XL',
    targetMarginRate: '0.55',
    version: 3,
  };

  beforeEach(() => {
    candidateBelongsToSellerMock.mockResolvedValue(true);
    pricingRepositoryMocks.findActiveVariantOverride.mockResolvedValue(
      PREVIOUS,
    );
    pricingRepositoryMocks.reviseVariantOverride.mockResolvedValue({
      id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      supplierCandidateId: CANDIDATE_ID,
      supplierVariantId: 'Black-1XL',
      version: 4,
      supersedesId: OVERRIDE_ID,
    });
  });

  it('supersedes and re-supplies the justification rather than inheriting it', async () => {
    const result = await saveVariantOverrideAction(VALID_INPUT);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.reviseVariantOverride).toHaveBeenCalledWith(
      TX,
      PREVIOUS,
      {
        targetMarginRate: '0.60',
        reason: VALID_INPUT.reason,
        additionalJustification: VALID_INPUT.additionalJustification,
        actorId: 'user-1',
      },
    );
    expect(pricingRepositoryMocks.removeVariantOverride).not.toHaveBeenCalled();
  });

  it('audits the edit as revised and continues the version chain', async () => {
    await saveVariantOverrideAction(VALID_INPUT);

    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'variant_pricing_override.revised',
        payload: expect.objectContaining({
          version: 4,
          supersedesId: OVERRIDE_ID,
          previousTargetMarginRate: '0.55',
        }),
      }),
    );
  });

  it('still creates at version 1 when there is no active override', async () => {
    pricingRepositoryMocks.findActiveVariantOverride.mockResolvedValue(null);
    pricingRepositoryMocks.createVariantOverride.mockResolvedValue({
      id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
      supplierCandidateId: CANDIDATE_ID,
      supplierVariantId: 'Black-1XL',
      version: 1,
      supersedesId: null,
    });

    const result = await saveVariantOverrideAction(VALID_INPUT);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.reviseVariantOverride).not.toHaveBeenCalled();
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'variant_pricing_override.created',
        payload: expect.objectContaining({
          version: 1,
          supersedesId: null,
          previousTargetMarginRate: null,
        }),
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

  it("returns not_found when the override does not actually belong to this candidate — never removes a different candidate/tenant's override", async () => {
    candidateBelongsToSellerMock.mockResolvedValue(true);
    pricingRepositoryMocks.removeProductOverride.mockResolvedValue(null);

    const result = await removeProductOverrideAction(OVERRIDE_ID, CANDIDATE_ID);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it('reverts to the category policy and records an explainable audit event', async () => {
    candidateBelongsToSellerMock.mockResolvedValue(true);
    pricingRepositoryMocks.removeProductOverride.mockResolvedValue({
      id: OVERRIDE_ID,
    });

    const result = await removeProductOverrideAction(OVERRIDE_ID, CANDIDATE_ID);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.removeProductOverride).toHaveBeenCalledWith(
      TX,
      OVERRIDE_ID,
      CANDIDATE_ID,
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

describe('policy history read actions', () => {
  const HISTORY = [
    {
      id: 'event-1',
      action: 'category_pricing_policy.created',
      createdAt: new Date('2026-08-01T00:00:00Z'),
      actorName: 'Rosa Villamor',
      actorEmail: 'rosa@sals3.com',
      payload: { reason: 'Initial setup.' },
    },
  ];

  it('getCategoryPolicyHistoryAction only needs pricing_policy:read, not :manage', async () => {
    listAuditHistoryForSellerEntityMock.mockResolvedValue(HISTORY);

    const result = await getCategoryPolicyHistoryAction('CAT-DIG-100801');

    expect(result).toEqual({ ok: true, data: HISTORY });
    expect(listAuditHistoryForSellerEntityMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        entityType: 'PricingCategoryPolicy',
        sellerAccountId: SELLER_A_ID,
        payloadEquals: { categoryCode: 'CAT-DIG-100801' },
      },
    );
  });

  it('getCategoryPolicyHistoryAction denies a caller without pricing_policy:read', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError());

    const result = await getCategoryPolicyHistoryAction('CAT-DIG-100801');

    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(listAuditHistoryForSellerEntityMock).not.toHaveBeenCalled();
  });

  it("getStoreDefaultHistoryAction always scopes by the caller's own sellerAccountId, ignoring any input", async () => {
    listAuditHistoryForSellerEntityMock.mockResolvedValue(HISTORY);

    const result = await getStoreDefaultHistoryAction();

    expect(result).toEqual({ ok: true, data: HISTORY });
    expect(listAuditHistoryForSellerEntityMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        entityType: 'PricingStoreDefault',
        sellerAccountId: SELLER_A_ID,
      },
    );
  });

  it("getFundingBufferHistoryAction always scopes by the caller's own sellerAccountId, ignoring any input", async () => {
    listAuditHistoryForSellerEntityMock.mockResolvedValue(HISTORY);

    const result = await getFundingBufferHistoryAction();

    expect(result).toEqual({ ok: true, data: HISTORY });
    expect(listAuditHistoryForSellerEntityMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        entityType: 'PricingFxAdjustmentPolicy',
        sellerAccountId: SELLER_A_ID,
      },
    );
  });

  it("every history action is scoped by the caller's own session, never a client-supplied seller id — none of them even accept one", async () => {
    // Regression guard: these three actions take only entity-identifying
    // parameters (category code, l1/l2, nothing at all) — there is no
    // sellerAccountId parameter for a caller to override in the first place.
    expect(getCategoryPolicyHistoryAction.length).toBe(1);
    expect(getStoreDefaultHistoryAction.length).toBe(0);
    expect(getFundingBufferHistoryAction.length).toBe(0);
  });
});

describe('saveStoreDefaultAction', () => {
  const VALID_INPUT = {
    targetMarginRate: '0.35',
    minContribution: '2.50',
    roundingRule: 'NEAREST_0_99',
    reason: 'Initial store-wide default while headcount is one.',
    marketCode: null,
  };

  it('denies a caller without pricing_policy:manage', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError());

    const result = await saveStoreDefaultAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(pricingRepositoryMocks.createStoreDefault).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range margin rate before touching the database', async () => {
    const result = await saveStoreDefaultAction({
      ...VALID_INPUT,
      targetMarginRate: '1.2',
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('rejects a negative or malformed contribution floor before touching the database', async () => {
    const negative = await saveStoreDefaultAction({
      ...VALID_INPUT,
      minContribution: '-1',
    });
    const threeDecimals = await saveStoreDefaultAction({
      ...VALID_INPUT,
      minContribution: '2.505',
    });

    expect(negative).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(threeDecimals).toMatchObject({
      ok: false,
      reason: 'invalid_input',
    });
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it('rate-limits repeated calls', async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false });

    const result = await saveStoreDefaultAction(VALID_INPUT);

    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('creates a new version-1 default with the floor in minor units, and audits it', async () => {
    pricingRepositoryMocks.findStoreDefaultForScope.mockResolvedValue(null);
    pricingRepositoryMocks.createStoreDefault.mockResolvedValue({
      id: POLICY_ID,
      version: 1,
      supersedesId: null,
    });

    const result = await saveStoreDefaultAction(VALID_INPUT);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.createStoreDefault).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        sellerAccountId: SELLER_A_ID,
        targetMarginRate: '0.35',
        minContributionMinor: BigInt(250),
        minContributionCurrency: 'USD',
        roundingRule: 'NEAREST_0_99',
      }),
    );
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'pricing_store_default.created',
        entityType: 'PricingStoreDefault',
      }),
    );
  });

  it('revises (supersedes) the existing active default instead of creating a duplicate', async () => {
    const existing = { id: POLICY_ID, version: 2 };
    pricingRepositoryMocks.findStoreDefaultForScope.mockResolvedValue(existing);
    pricingRepositoryMocks.reviseStoreDefault.mockResolvedValue({
      id: 'new-id',
      version: 3,
      supersedesId: POLICY_ID,
    });

    const result = await saveStoreDefaultAction(VALID_INPUT);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.reviseStoreDefault).toHaveBeenCalledWith(
      TX,
      existing,
      expect.objectContaining({ minContributionMinor: BigInt(250) }),
    );
    expect(pricingRepositoryMocks.createStoreDefault).not.toHaveBeenCalled();
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'pricing_store_default.revised' }),
    );
  });

  it('a whole-dollar floor converts exactly to minor units', async () => {
    pricingRepositoryMocks.findStoreDefaultForScope.mockResolvedValue(null);
    pricingRepositoryMocks.createStoreDefault.mockResolvedValue({
      id: POLICY_ID,
      version: 1,
      supersedesId: null,
    });

    await saveStoreDefaultAction({ ...VALID_INPUT, minContribution: '3' });

    expect(pricingRepositoryMocks.createStoreDefault).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ minContributionMinor: BigInt(300) }),
    );
  });
});

describe('deactivateStoreDefaultAction', () => {
  it('refuses to deactivate a default claimed to belong to a different seller (IDOR guard)', async () => {
    const result = await deactivateStoreDefaultAction(POLICY_ID, SELLER_B_ID);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(
      pricingRepositoryMocks.deactivateStoreDefault,
    ).not.toHaveBeenCalled();
  });

  it('returns not_found when the policy id does not actually belong to this seller in the database', async () => {
    pricingRepositoryMocks.deactivateStoreDefault.mockResolvedValue(null);

    const result = await deactivateStoreDefaultAction(POLICY_ID, SELLER_A_ID);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it('deactivates and audits when the seller id matches the caller', async () => {
    pricingRepositoryMocks.deactivateStoreDefault.mockResolvedValue({
      id: POLICY_ID,
      version: 1,
    });

    const result = await deactivateStoreDefaultAction(POLICY_ID, SELLER_A_ID);

    expect(result).toEqual({ ok: true });
    expect(pricingRepositoryMocks.deactivateStoreDefault).toHaveBeenCalledWith(
      TX,
      POLICY_ID,
      SELLER_A_ID,
    );
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'pricing_store_default.deactivated' }),
    );
  });
});

describe('field-level validation messages', () => {
  /**
   * `ActionResult.fieldErrors` was declared from the first version of this
   * file and never populated, so the UI could only say "check the highlighted
   * fields" while highlighting nothing. The owner hit exactly that on
   * 2026-08-20: the real cause was a reason under 10 characters and nothing
   * on screen said so.
   */
  it('names the field that failed, not just that something did', async () => {
    const result = await saveStoreDefaultAction({
      targetMarginRate: '0.35',
      minContribution: '2.50',
      roundingRule: 'NONE',
      reason: 'short',
      marketCode: null,
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.fieldErrors?.reason).toMatch(/10 characters or more/);
  });

  it('reports a bad margin against the margin field', async () => {
    const result = await saveStoreDefaultAction({
      targetMarginRate: '1.5',
      minContribution: '0',
      roundingRule: 'NONE',
      reason: 'A perfectly valid reason here.',
      marketCode: null,
    });

    if (result.ok) throw new Error('expected a refusal');
    expect(result.fieldErrors?.targetMarginRate).toBeDefined();
    expect(result.fieldErrors?.reason).toBeUndefined();
  });

  it('reports a bad contribution floor against the floor field', async () => {
    const result = await saveStoreDefaultAction({
      targetMarginRate: '0.35',
      minContribution: '2.505',
      roundingRule: 'NONE',
      reason: 'A perfectly valid reason here.',
      marketCode: null,
    });

    if (result.ok) throw new Error('expected a refusal');
    expect(result.fieldErrors?.minContribution).toBeDefined();
  });

  it('does the same for the funding buffer, which shares the defect', async () => {
    const result = await saveFundingBufferPolicyAction({
      adjustmentRate: '0.025',
      reason: 'nope',
    });

    if (result.ok) throw new Error('expected a refusal');
    expect(result.fieldErrors?.reason).toMatch(/10 characters or more/);
  });
});

describe('applyMarginCsvAction', () => {
  const HEADER = 'category_code,category_path,margin_percent,rounding';
  const REASON = 'Bulk repricing after the supplier cost review.';

  function category(code: string, id: string) {
    return { id, code, path: `Path ${code}` };
  }

  beforeEach(() => {
    pricingRepositoryMocks.findCategoriesByCodes.mockResolvedValue([
      category('CAT-GGL-1', 'cat-1'),
      category('CAT-GGL-2', 'cat-2'),
    ]);
    pricingRepositoryMocks.findActiveCategoryPolicy.mockResolvedValue(null);
    pricingRepositoryMocks.createCategoryPolicy.mockResolvedValue({
      id: 'policy-new',
      version: 1,
      supersedesId: null,
    });
  });

  it('denies a caller without pricing_policy:manage', async () => {
    requirePermissionMock.mockRejectedValue(new PermissionError());

    const result = await applyMarginCsvAction({
      csv: `${HEADER}\nCAT-GGL-1,Anything,35,NONE`,
      reason: REASON,
    });

    expect(result).toEqual({ ok: false, reason: 'denied' });
    expect(pricingRepositoryMocks.createCategoryPolicy).not.toHaveBeenCalled();
  });

  it('writes every row inside one transaction, with one audit event each', async () => {
    const result = await applyMarginCsvAction({
      csv: [
        HEADER,
        'CAT-GGL-1,Anything,35,NONE',
        'CAT-GGL-2,Anything,40,NONE',
      ].join('\n'),
      reason: REASON,
    });

    expect(result).toMatchObject({ ok: true });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(pricingRepositoryMocks.createCategoryPolicy).toHaveBeenCalledTimes(
      2,
    );
    // Bulk is another door into the same writer, not a shortcut past the
    // audit trail.
    expect(appendAuditEventMock).toHaveBeenCalledTimes(2);
    expect(appendAuditEventMock).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        action: 'category_pricing_policy.created',
        payload: expect.objectContaining({ source: 'csv-import' }),
      }),
    );
  });

  /**
   * All-or-nothing. A half-applied price change leaves the catalogue priced
   * by two different decisions with nothing on screen saying which rows took.
   */
  it('writes nothing at all when one line is malformed', async () => {
    const result = await applyMarginCsvAction({
      csv: [
        HEADER,
        'CAT-GGL-1,Anything,35,NONE',
        'CAT-GGL-2,Anything,zzz,NONE',
      ].join('\n'),
      reason: REASON,
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.rowErrors?.[0]).toMatch(/Line 3/);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(pricingRepositoryMocks.createCategoryPolicy).not.toHaveBeenCalled();
  });

  it('names an unknown category by line, and writes nothing', async () => {
    pricingRepositoryMocks.findCategoriesByCodes.mockResolvedValue([
      category('CAT-GGL-1', 'cat-1'),
    ]);

    const result = await applyMarginCsvAction({
      csv: [
        HEADER,
        'CAT-GGL-1,Anything,35,NONE',
        'CAT-GGL-9,Anything,40,NONE',
      ].join('\n'),
      reason: REASON,
    });

    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.rowErrors?.[0]).toMatch(/CAT-GGL-9 is not a Sals3 category/);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('an empty margin cell deactivates that category rather than writing zero', async () => {
    pricingRepositoryMocks.findActiveCategoryPolicy.mockResolvedValue({
      id: 'policy-1',
      targetMarginRate: '0.350000',
      roundingRule: 'NONE',
      version: 1,
    });
    pricingRepositoryMocks.deactivateCategoryPolicy.mockResolvedValue({
      id: 'policy-1',
      version: 1,
    });

    const result = await applyMarginCsvAction({
      csv: `${HEADER}\nCAT-GGL-1,Anything,,`,
      reason: REASON,
    });

    expect(result).toMatchObject({ ok: true, data: { cleared: 1 } });
    expect(pricingRepositoryMocks.deactivateCategoryPolicy).toHaveBeenCalled();
    expect(pricingRepositoryMocks.createCategoryPolicy).not.toHaveBeenCalled();
  });

  it('skips a row that already matches, so no version or audit event records a non-change', async () => {
    pricingRepositoryMocks.findActiveCategoryPolicy.mockResolvedValue({
      id: 'policy-1',
      targetMarginRate: '0.350000',
      roundingRule: 'NONE',
      version: 1,
    });

    const result = await applyMarginCsvAction({
      csv: `${HEADER}\nCAT-GGL-1,Anything,35,NONE`,
      reason: REASON,
    });

    expect(result).toMatchObject({
      ok: true,
      data: { unchanged: 1, written: 0 },
    });
    expect(pricingRepositoryMocks.reviseCategoryPolicy).not.toHaveBeenCalled();
    expect(appendAuditEventMock).not.toHaveBeenCalled();
  });

  it('revises rather than duplicating when the category already has a different rate', async () => {
    pricingRepositoryMocks.findActiveCategoryPolicy.mockResolvedValue({
      id: 'policy-1',
      targetMarginRate: '0.200000',
      roundingRule: 'NONE',
      version: 1,
    });
    pricingRepositoryMocks.reviseCategoryPolicy.mockResolvedValue({
      id: 'policy-2',
      version: 2,
      supersedesId: 'policy-1',
    });

    const result = await applyMarginCsvAction({
      csv: `${HEADER}\nCAT-GGL-1,Anything,35,NONE`,
      reason: REASON,
    });

    expect(result).toMatchObject({ ok: true, data: { written: 1 } });
    expect(pricingRepositoryMocks.reviseCategoryPolicy).toHaveBeenCalled();
    expect(pricingRepositoryMocks.createCategoryPolicy).not.toHaveBeenCalled();
  });

  it('refuses a reason too short to explain a bulk change', async () => {
    const result = await applyMarginCsvAction({
      csv: `${HEADER}\nCAT-GGL-1,Anything,35,NONE`,
      reason: 'nope',
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_input' });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.fieldErrors?.reason).toBeDefined();
  });
});
