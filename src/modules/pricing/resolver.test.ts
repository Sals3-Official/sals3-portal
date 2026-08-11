import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveProductPricing } from './resolver';
import type { PricingResolutionInput } from './types';

const mocks = vi.hoisted(() => ({
  findCategoryByCode: vi.fn(),
  findActiveCategoryPolicy: vi.fn(),
  findActiveProductOverride: vi.fn(),
  findActiveVariantOverride: vi.fn(),
  findActiveFxAdjustmentPolicy: vi.fn(),
  resolveReferenceFxRate: vi.fn(),
}));

vi.mock('./repository', () => mocks);

// `resolveReferenceFxRate` only returns non-null for an identical currency
// pair today (no approved cross-currency provider exists - see
// `reference-fx.ts`), which means the FX-adjustment-policy branch below is
// currently unreachable through the real function. Mocking it here to
// simulate a future approved provider is the only way to prove that branch
// (funding-rail requirement, policy lookup, expiry, and the actual
// adjustment math) is correct before it ever activates for real.
vi.mock('./reference-fx', () => ({
  resolveReferenceFxRate: mocks.resolveReferenceFxRate,
}));

const EXECUTOR = {} as never;

const BASE_INPUT: PricingResolutionInput = {
  sellerAccountId: 'seller-1',
  categoryCode: 'CAT-DIG-100801',
  categoryMappingConfidence: 'EXACT',
  supplierCandidateId: null,
  supplierVariantId: null,
  supplierCost: { amountMinor: 1000, currency: 'USD' },
  supplierCostObservedAt: '2026-08-11T00:00:00.000Z',
  settlementCurrency: 'USD',
  fundingRail: null,
};

const CATEGORY = {
  id: 'category-1',
  code: 'CAT-DIG-100801',
  path: 'Digital Goods > Mobile Load > Telco Load Top-up',
};

function categoryPolicy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'policy-1',
    sellerAccountId: 'seller-1',
    categoryId: 'category-1',
    targetMarginRate: '0.200000',
    roundingRule: 'NONE',
    status: 'ACTIVE',
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCategoryByCode.mockResolvedValue(CATEGORY);
  mocks.findActiveCategoryPolicy.mockResolvedValue(categoryPolicy());
  mocks.findActiveProductOverride.mockResolvedValue(null);
  mocks.findActiveVariantOverride.mockResolvedValue(null);
  mocks.findActiveFxAdjustmentPolicy.mockResolvedValue(null);
  // Real identity behavior for same-currency, matching `reference-fx.ts`.
  mocks.resolveReferenceFxRate.mockImplementation(
    (source: string, target: string) =>
      source === target
        ? {
            rateScaled: BigInt(1_000_000),
            source: 'IDENTITY',
            observedAt: '2026-08-11T00:00:00.000Z',
          }
        : null,
  );
});

describe('resolveProductPricing', () => {
  it('resolves a category-level PRODUCT_MARGIN_ESTIMATE using the stable category code, not a label', async () => {
    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(mocks.findCategoryByCode).toHaveBeenCalledWith(
      EXECUTOR,
      'CAT-DIG-100801',
    );
    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.resolvedLayer).toBe('CATEGORY');
      // cost 1000 / (1 - 0.20) = 1250
      expect(result.suggestedItemPrice).toEqual({
        amountMinor: 1250,
        currency: 'USD',
      });
    }
  });

  it('returns CATEGORY_MAPPING_REQUIRES_REVIEW for an ambiguous mapping, never a silently inherited policy', async () => {
    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      categoryMappingConfidence: 'AMBIGUOUS',
    });

    expect(result).toEqual({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'CATEGORY_MAPPING_REQUIRES_REVIEW',
      reasonLabel: 'Category mapping requires review',
      resolverVersion: expect.any(String),
    });
    expect(mocks.findCategoryByCode).not.toHaveBeenCalled();
  });

  it('returns CATEGORY_MAPPING_REQUIRES_REVIEW for an unmapped category', async () => {
    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      categoryCode: null,
      categoryMappingConfidence: 'UNMAPPED',
    });

    expect(result.outcome).toBe('PRICING_UNAVAILABLE');
    if (result.outcome === 'PRICING_UNAVAILABLE') {
      expect(result.reason).toBe('CATEGORY_MAPPING_REQUIRES_REVIEW');
    }
  });

  it('returns CATEGORY_NOT_FOUND when the code does not resolve to a real taxonomy row', async () => {
    mocks.findCategoryByCode.mockResolvedValue(null);

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRICING_UNAVAILABLE');
    if (result.outcome === 'PRICING_UNAVAILABLE') {
      expect(result.reason).toBe('CATEGORY_NOT_FOUND');
    }
  });

  it('returns CATEGORY_POLICY_REQUIRED with no silent global-margin fallback when no active policy exists', async () => {
    mocks.findActiveCategoryPolicy.mockResolvedValue(null);

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result).toEqual({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'CATEGORY_POLICY_REQUIRED',
      reasonLabel: 'Category policy required',
      resolverVersion: expect.any(String),
    });
  });

  it('applies exact precedence: product override beats category', async () => {
    mocks.findActiveProductOverride.mockResolvedValue({
      id: 'override-product-1',
      targetMarginRate: '0.500000',
      version: 3,
      status: 'ACTIVE',
    });

    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      supplierCandidateId: 'candidate-1',
    });

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.resolvedLayer).toBe('PRODUCT_OVERRIDE');
      expect(result.productOverrideId).toBe('override-product-1');
      expect(result.productOverrideVersion).toBe(3);
      // cost 1000 / (1 - 0.50) = 2000
      expect(result.suggestedItemPrice.amountMinor).toBe(2000);
    }
  });

  it('applies exact precedence: variant override beats product override', async () => {
    mocks.findActiveProductOverride.mockResolvedValue({
      id: 'override-product-1',
      targetMarginRate: '0.500000',
      version: 1,
      status: 'ACTIVE',
    });
    mocks.findActiveVariantOverride.mockResolvedValue({
      id: 'override-variant-1',
      targetMarginRate: '0.750000',
      version: 1,
      status: 'ACTIVE',
    });

    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      supplierCandidateId: 'candidate-1',
      supplierVariantId: 'variant-1',
    });

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.resolvedLayer).toBe('VARIANT_OVERRIDE');
      expect(result.variantOverrideId).toBe('override-variant-1');
      expect(result.productOverrideId).toBe('override-product-1');
    }
  });

  it('removing the active override restores the immediately lower layer (category)', async () => {
    // "Removed" simulated by the repository no longer finding an ACTIVE row.
    mocks.findActiveProductOverride.mockResolvedValue(null);

    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      supplierCandidateId: 'candidate-1',
    });

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.resolvedLayer).toBe('CATEGORY');
      expect(result.productOverrideId).toBeNull();
    }
  });

  it('same-currency (identity) resolution never requires a funding rail or FX policy', async () => {
    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      fundingRail: null,
    });

    expect(mocks.findActiveFxAdjustmentPolicy).not.toHaveBeenCalled();
    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.fxAdjustmentRate).toBeNull();
      expect(result.referenceFxRate).toBe('1.000000');
    }
  });

  it('fails closed with REFERENCE_FX_UNAVAILABLE for a currency pair no approved provider covers', async () => {
    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      supplierCost: { amountMinor: 1000, currency: 'USD' },
      settlementCurrency: 'AUD',
    });

    expect(result).toEqual({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'REFERENCE_FX_UNAVAILABLE',
      reasonLabel: 'Reference FX unavailable',
      resolverVersion: expect.any(String),
    });
    // Never falls back to zero adjustment or an unrelated pair's policy.
    expect(mocks.findActiveFxAdjustmentPolicy).not.toHaveBeenCalled();
  });

  it('returns SUPPLIER_COST_UNAVAILABLE rather than treating a missing cost as zero', async () => {
    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      supplierCost: null,
    });

    expect(result.outcome).toBe('PRICING_UNAVAILABLE');
    if (result.outcome === 'PRICING_UNAVAILABLE') {
      expect(result.reason).toBe('SUPPLIER_COST_UNAVAILABLE');
    }
  });

  it('returns INVALID_MARGIN_RATE for a corrupt/out-of-range stored rate rather than computing a nonsensical price', async () => {
    mocks.findActiveCategoryPolicy.mockResolvedValue(
      categoryPolicy({ targetMarginRate: '1.500000' }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRICING_UNAVAILABLE');
    if (result.outcome === 'PRICING_UNAVAILABLE') {
      expect(result.reason).toBe('INVALID_MARGIN_RATE');
    }
  });

  it('never labels the result as net profit, landed cost, or an order-level margin', async () => {
    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain('net profit');
    expect(serialized).not.toContain('landed cost');
    expect(serialized).not.toContain('order contribution');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.scopeNote).toBe(
        'This is product-only price guidance; checkout freight is not included.',
      );
    }
  });

  it('an unavailable result never carries a price, cost, or rate field', async () => {
    mocks.findActiveCategoryPolicy.mockResolvedValue(null);

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result).not.toHaveProperty('suggestedItemPrice');
    expect(result).not.toHaveProperty('effectiveProductCost');
    expect(result).not.toHaveProperty('targetMarginRate');
  });

  it('never leaks a supplier credential or secret-shaped field', async () => {
    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      supplierCandidateId: 'candidate-1',
    });

    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toContain('apikey');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('secret');
  });
});

/**
 * The FX-adjustment-policy branch (funding-rail requirement, policy
 * lookup, expiry, and the actual adjustment math) is unreachable through
 * the real `resolveReferenceFxRate` today, since no approved cross-currency
 * provider exists yet. These tests simulate one becoming available so the
 * branch is proven correct before it ever activates for real.
 */
describe('resolveProductPricing — FX adjustment (simulated future cross-currency provider)', () => {
  const CROSS_CURRENCY_INPUT: PricingResolutionInput = {
    ...BASE_INPUT,
    supplierCost: { amountMinor: 1000, currency: 'USD' },
    settlementCurrency: 'AUD',
    fundingRail: 'CJ_WALLET_WIRE_TRANSFER',
  };

  beforeEach(() => {
    mocks.resolveReferenceFxRate.mockReturnValue({
      rateScaled: BigInt(1_500_000), // 1 USD = 1.5 AUD, hypothetical
      source: 'SIMULATED',
      observedAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('requires a funding rail before it will even look up an FX policy', async () => {
    const result = await resolveProductPricing(EXECUTOR, {
      ...CROSS_CURRENCY_INPUT,
      fundingRail: null,
    });

    expect(result).toEqual({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'FX_ADJUSTMENT_POLICY_REQUIRED',
      reasonLabel: 'FX adjustment policy required',
      resolverVersion: expect.any(String),
    });
    expect(mocks.findActiveFxAdjustmentPolicy).not.toHaveBeenCalled();
  });

  it('fails closed with FX_ADJUSTMENT_POLICY_REQUIRED when no active policy exists for the pair+rail', async () => {
    mocks.findActiveFxAdjustmentPolicy.mockResolvedValue(null);

    const result = await resolveProductPricing(EXECUTOR, CROSS_CURRENCY_INPUT);

    expect(result.outcome).toBe('PRICING_UNAVAILABLE');
    if (result.outcome === 'PRICING_UNAVAILABLE') {
      expect(result.reason).toBe('FX_ADJUSTMENT_POLICY_REQUIRED');
    }
    expect(mocks.findActiveFxAdjustmentPolicy).toHaveBeenCalledWith(
      EXECUTOR,
      'seller-1',
      'USD',
      'AUD',
      'CJ_WALLET_WIRE_TRANSFER',
    );
  });

  it('fails closed with POLICY_EXPIRED for a lapsed FX adjustment rather than using a stale rate', async () => {
    mocks.findActiveFxAdjustmentPolicy.mockResolvedValue({
      id: 'fx-1',
      version: 1,
      adjustmentRate: '0.025000',
      effectiveTo: new Date('2020-01-01T00:00:00.000Z'),
    });

    const result = await resolveProductPricing(EXECUTOR, CROSS_CURRENCY_INPUT);

    expect(result.outcome).toBe('PRICING_UNAVAILABLE');
    if (result.outcome === 'PRICING_UNAVAILABLE') {
      expect(result.reason).toBe('POLICY_EXPIRED');
    }
  });

  it('applies the active FX adjustment on top of the reference rate, separate from margin', async () => {
    mocks.findActiveFxAdjustmentPolicy.mockResolvedValue({
      id: 'fx-1',
      version: 2,
      adjustmentRate: '0.025000',
      effectiveTo: null,
    });

    const result = await resolveProductPricing(EXECUTOR, CROSS_CURRENCY_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.fxAdjustmentRate).toBe('0.025000');
      expect(result.fxAdjustmentPolicyId).toBe('fx-1');
      expect(result.fxAdjustmentPolicyVersion).toBe(2);
      // cost 1000 USD * (1.5 * 1.025) = 1537.5 -> round half up = 1538
      // effective cost 1538 AUD / (1 - 0.20 margin) = 1922.5 -> 1923
      expect(result.effectiveProductCost).toEqual({
        amountMinor: 1538,
        currency: 'AUD',
      });
      expect(result.suggestedItemPrice.amountMinor).toBe(1923);
    }
  });
});
