import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveProductPricing } from './resolver';
import type { PricingResolutionInput } from './types';

const mocks = vi.hoisted(() => ({
  findCategoryByCode: vi.fn(),
  findNearestActiveCategoryPolicy: vi.fn(),
  findActiveStoreDefault: vi.fn(),
  findActiveProductOverride: vi.fn(),
  findActiveVariantOverride: vi.fn(),
  findActiveFundingBufferPolicy: vi.fn(),
  resolveReferenceFxRate: vi.fn(),
}));

vi.mock('./repository', () => mocks);

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

function fundingBufferPolicy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'buffer-1',
    sellerAccountId: 'seller-1',
    adjustmentRate: '0.000000',
    version: 1,
    effectiveTo: null,
    ...overrides,
  };
}

function storeDefault(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'store-default-1',
    sellerAccountId: 'seller-1',
    targetMarginRate: '0.350000',
    minContributionMinor: BigInt(0),
    minContributionCurrency: 'USD',
    roundingRule: 'NONE',
    status: 'ACTIVE',
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCategoryByCode.mockResolvedValue(CATEGORY);
  mocks.findNearestActiveCategoryPolicy.mockResolvedValue({
    policy: categoryPolicy(),
    sourceCategory: CATEGORY,
  });
  // No store default by default: the pre-v3 test scenarios below hold
  // unchanged, and the dedicated describe block covers the new layer.
  mocks.findActiveStoreDefault.mockResolvedValue(null);
  mocks.findActiveProductOverride.mockResolvedValue(null);
  mocks.findActiveVariantOverride.mockResolvedValue(null);
  // Every happy-path test needs a resolvable buffer now that it always
  // applies — a zero-rate buffer is a real, deliberate value (see the
  // dedicated "funding buffer" describe block below for the non-zero
  // cases), distinct from no policy at all.
  mocks.findActiveFundingBufferPolicy.mockResolvedValue(fundingBufferPolicy());
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

  it('returns PRICING_POLICY_REQUIRED with no silent global-margin fallback when neither a chain policy nor a store default exists', async () => {
    mocks.findNearestActiveCategoryPolicy.mockResolvedValue(null);
    mocks.findActiveStoreDefault.mockResolvedValue(null);

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result).toEqual({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'PRICING_POLICY_REQUIRED',
      reasonLabel:
        'No margin policy — set a store default or a category margin in Market rules',
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

  it('fails closed with REFERENCE_FX_UNAVAILABLE for a currency pair no approved provider covers, before ever looking up a funding buffer', async () => {
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
    // Never falls back to zero adjustment or an unrelated pair's policy —
    // and the reference-FX step and the funding-buffer step stay distinct:
    // a currency mismatch is caught before the buffer is ever consulted.
    expect(mocks.findActiveFundingBufferPolicy).not.toHaveBeenCalled();
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
    mocks.findNearestActiveCategoryPolicy.mockResolvedValue({
      policy: categoryPolicy({ targetMarginRate: '1.500000' }),
      sourceCategory: CATEGORY,
    });

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
    mocks.findNearestActiveCategoryPolicy.mockResolvedValue(null);

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
 * The funding buffer (ADR-015 §4) always applies as a cost-basis uplift —
 * unconditionally, regardless of whether the settlement currency matches
 * the supplier cost currency. It is a distinct step from the reference-FX
 * conversion above: never merge a buyer-settlement conversion with the
 * seller's own funding-cost buffer.
 */
describe('resolveProductPricing — funding buffer (always applied)', () => {
  it('returns FUNDING_BUFFER_REQUIRED when no buffer is configured, even under same-currency identity resolution', async () => {
    mocks.findActiveFundingBufferPolicy.mockResolvedValue(null);

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result).toEqual({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'FUNDING_BUFFER_REQUIRED',
      reasonLabel: 'Funding buffer required',
      resolverVersion: expect.any(String),
    });
  });

  it('fails closed with FUNDING_BUFFER_EXPIRED for a lapsed buffer rather than using a stale rate', async () => {
    mocks.findActiveFundingBufferPolicy.mockResolvedValue(
      fundingBufferPolicy({
        adjustmentRate: '0.025000',
        effectiveTo: new Date('2020-01-01T00:00:00.000Z'),
      }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRICING_UNAVAILABLE');
    if (result.outcome === 'PRICING_UNAVAILABLE') {
      expect(result.reason).toBe('FUNDING_BUFFER_EXPIRED');
    }
  });

  it('applies a non-zero buffer on top of the reference rate under identity (same-currency) settlement, separate from margin', async () => {
    mocks.findActiveFundingBufferPolicy.mockResolvedValue(
      fundingBufferPolicy({ adjustmentRate: '0.030000', version: 4 }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.fundingBufferRate).toBe('0.030000');
      expect(result.fundingBufferPolicyId).toBe('buffer-1');
      expect(result.fundingBufferPolicyVersion).toBe(4);
      // reference rate 1.0 * 1.03 = 1.03; cost 1000 * 1.03 = 1030
      expect(result.effectiveProductCost).toEqual({
        amountMinor: 1030,
        currency: 'USD',
      });
      // 1030 / (1 - 0.20 margin) = 1287.5 -> round half up = 1288
      expect(result.suggestedItemPrice.amountMinor).toBe(1288);
    }
  });

  it('a zero-rate buffer is a real, deliberately-chosen value distinct from no policy at all', async () => {
    mocks.findActiveFundingBufferPolicy.mockResolvedValue(
      fundingBufferPolicy({ adjustmentRate: '0.000000' }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.fundingBufferRate).toBe('0.000000');
      expect(result.suggestedItemPrice.amountMinor).toBe(1250);
    }
  });
});

/**
 * v3: the chain — nearest-ancestor category resolution, the store-default
 * base layer, and the minimum-contribution floor.
 */
describe('resolveProductPricing — inheritance and the contribution floor', () => {
  const ANCESTOR = {
    id: 'category-ancestor',
    code: 'CAT-GGL-166',
    path: 'Digital Goods',
  };

  it('an ancestor policy resolves as CATEGORY and records which node actually supplied it', async () => {
    mocks.findNearestActiveCategoryPolicy.mockResolvedValue({
      policy: categoryPolicy({ id: 'policy-dept' }),
      sourceCategory: ANCESTOR,
    });

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.resolvedLayer).toBe('CATEGORY');
      // The product keeps its own category identity…
      expect(result.categoryCode).toBe('CAT-DIG-100801');
      // …while the decision records the ancestor that priced it.
      expect(result.policySourceCategoryCode).toBe('CAT-GGL-166');
      expect(result.policySourceCategoryPath).toBe('Digital Goods');
      expect(result.categoryPolicyId).toBe('policy-dept');
    }
  });

  it('falls back to the store default when no node on the chain carries a policy', async () => {
    mocks.findNearestActiveCategoryPolicy.mockResolvedValue(null);
    mocks.findActiveStoreDefault.mockResolvedValue(
      storeDefault({ targetMarginRate: '0.350000', version: 2 }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.resolvedLayer).toBe('STORE_DEFAULT');
      expect(result.storeDefaultPolicyId).toBe('store-default-1');
      expect(result.storeDefaultPolicyVersion).toBe(2);
      expect(result.categoryPolicyId).toBeNull();
      expect(result.policySourceCategoryCode).toBeNull();
      // cost 1000 / (1 - 0.35) = 1538.46… -> round half up 1538
      expect(result.suggestedItemPrice.amountMinor).toBe(1538);
    }
  });

  it("the store default's rounding rule applies when it is the resolving base", async () => {
    mocks.findNearestActiveCategoryPolicy.mockResolvedValue(null);
    mocks.findActiveStoreDefault.mockResolvedValue(
      storeDefault({ roundingRule: 'NEAREST_0_99' }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.roundingRule).toBe('NEAREST_0_99');
      // 1538 -> 1599
      expect(result.roundedSuggestedItemPrice.amountMinor).toBe(1599);
    }
  });

  it('the contribution floor lifts a cheap item above the pure percentage price', async () => {
    // Category margin 20%: cost 1000 -> 1250. Floor US$5.00: 1000 + 500 = 1500.
    mocks.findActiveStoreDefault.mockResolvedValue(
      storeDefault({ minContributionMinor: BigInt(500) }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      // The margin still came from the category layer…
      expect(result.resolvedLayer).toBe('CATEGORY');
      // …but the floor set the price.
      expect(result.contributionFloorApplied).toBe(true);
      expect(result.suggestedItemPrice.amountMinor).toBe(1500);
      expect(result.minContribution).toEqual({
        amountMinor: 500,
        currency: 'USD',
      });
    }
  });

  it('the floor stays quiet when the percentage already clears it', async () => {
    // 20% margin on 1000 -> 1250; floor US$1.00 -> 1100 loses.
    mocks.findActiveStoreDefault.mockResolvedValue(
      storeDefault({ minContributionMinor: BigInt(100) }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.contributionFloorApplied).toBe(false);
      expect(result.suggestedItemPrice.amountMinor).toBe(1250);
    }
  });

  it('fails closed when the floor currency cannot be compared against the settlement currency', async () => {
    mocks.findActiveStoreDefault.mockResolvedValue(
      storeDefault({
        minContributionMinor: BigInt(500),
        minContributionCurrency: 'AUD',
      }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRICING_UNAVAILABLE');
    if (result.outcome === 'PRICING_UNAVAILABLE') {
      expect(result.reason).toBe('CONTRIBUTION_FLOOR_CURRENCY_MISMATCH');
    }
  });

  it('a zero floor is a real no-op, never a mismatch and never applied', async () => {
    mocks.findActiveStoreDefault.mockResolvedValue(
      storeDefault({
        minContributionMinor: BigInt(0),
        // Deliberately mismatched: a zero floor must not trip the
        // currency check, because there is nothing to compare.
        minContributionCurrency: 'AUD',
      }),
    );

    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.contributionFloorApplied).toBe(false);
      expect(result.suggestedItemPrice.amountMinor).toBe(1250);
    }
  });

  it('an override still beats everything, and the floor still applies on top of it', async () => {
    mocks.findActiveStoreDefault.mockResolvedValue(
      storeDefault({ minContributionMinor: BigInt(5000) }),
    );
    mocks.findActiveProductOverride.mockResolvedValue({
      id: 'override-product-1',
      targetMarginRate: '0.500000',
      version: 1,
      status: 'ACTIVE',
    });

    const result = await resolveProductPricing(EXECUTOR, {
      ...BASE_INPUT,
      supplierCandidateId: 'candidate-1',
    });

    expect(result.outcome).toBe('PRODUCT_MARGIN_ESTIMATE');
    if (result.outcome === 'PRODUCT_MARGIN_ESTIMATE') {
      expect(result.resolvedLayer).toBe('PRODUCT_OVERRIDE');
      // 50% margin: 1000 -> 2000; floor 1000 + 5000 = 6000 wins anyway.
      expect(result.contributionFloorApplied).toBe(true);
      expect(result.suggestedItemPrice.amountMinor).toBe(6000);
    }
  });

  it('the resolver version stamps v3 so stored v2 decisions stay traceable to the old logic', async () => {
    const result = await resolveProductPricing(EXECUTOR, BASE_INPUT);

    expect(result.resolverVersion).toBe('pricing-resolver-v3');
  });
});
