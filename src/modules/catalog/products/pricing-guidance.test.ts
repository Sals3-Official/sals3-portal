// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveProductPricingMock } = vi.hoisted(() => ({
  resolveProductPricingMock: vi.fn(),
}));

vi.mock('@/modules/pricing/resolver', () => ({
  resolveProductPricing: resolveProductPricingMock,
}));

const { findActiveProfileForSellerMock, capabilitiesMock } = vi.hoisted(() => ({
  findActiveProfileForSellerMock: vi.fn(),
  capabilitiesMock: vi.fn(),
}));

vi.mock('@/modules/market-config/repository', () => ({
  findActiveProfileForSeller: findActiveProfileForSellerMock,
}));

vi.mock('@/modules/market-config/capabilities', () => ({
  resolveSellerMarketCapabilities: capabilitiesMock,
}));

/* eslint-disable import/first */
import resolveEditorPricingGuidance from './pricing-guidance';

const SELLER_ID = '11111111-1111-4111-a111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-a222-222222222222';

/** Two selects: the product, then its variants. */
function executorReturning(productRows: unknown[], variantRows: unknown[]) {
  let call = -1;

  function chain(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    const self = (): unknown => builder;

    ['from', 'leftJoin', 'innerJoin', 'where', 'limit'].forEach((name) => {
      builder[name] = vi.fn(self);
    });
    builder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

    return builder;
  }

  return {
    select: vi.fn(() => {
      call += 1;
      return chain(call === 0 ? productRows : variantRows);
    }),
  };
}

function variantRow(overrides: Record<string, unknown> = {}) {
  return {
    variantId: 'variant-1',
    supplierCandidateId: 'candidate-1',
    supplierVariantId: 'cj-variant-1',
    costMinor: 110,
    costCurrency: 'USD',
    observedAt: new Date('2026-08-18T02:49:00.000Z'),
    offerDecision: { resolvedLayer: 'CATEGORY' },
    offerResolverVersion: 'pricing-resolver-v3',
    ...overrides,
  };
}

const PRODUCT = [{ categoryCode: 'CAT-GGL-1604', confidence: 'EXACT' }];

function resolved(amountMinor: number, marginRate = '0.750000') {
  return {
    outcome: 'PRODUCT_MARGIN_ESTIMATE',
    resolvedLayer: 'CATEGORY',
    targetMarginRate: marginRate,
    policySourceCategoryPath: 'Apparel & Accessories > Clothing Accessories',
    roundedSuggestedItemPrice: { amountMinor, currency: 'USD' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findActiveProfileForSellerMock.mockResolvedValue({
    destinationCountryCode: 'AU',
  });
  capabilitiesMock.mockReturnValue({
    destinations: [{ destinationCountryCode: 'PH' }],
  });
});

describe('resolveEditorPricingGuidance', () => {
  it('prices each variant from the supplier cost through the account’s rules', async () => {
    const executor = executorReturning(PRODUCT, [variantRow()]);
    resolveProductPricingMock.mockResolvedValue(resolved(440));

    const [guidance] = await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(resolveProductPricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categoryCode: 'CAT-GGL-1604',
        supplierCost: { amountMinor: 110, currency: 'USD' },
        marketCode: 'AU',
      }),
    );
    expect(guidance).toMatchObject({
      suggestedPriceMinor: 440,
      suggestedPriceCurrency: 'USD',
      sourceCategoryPath: 'Apparel & Accessories > Clothing Accessories',
      sellerOverridden: false,
    });
  });

  /**
   * The rule is stored as a margin and read as a markup, because markup over
   * cost is the unit the bulk sheet speaks. 0.75 of the sale price is 300% on
   * top of cost — one price, two names.
   */
  it('names the rule in the unit the spreadsheet uses', async () => {
    const executor = executorReturning(PRODUCT, [variantRow()]);
    resolveProductPricingMock.mockResolvedValue(resolved(440, '0.750000'));

    const [guidance] = await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(guidance.markupPercent).toBe(300);
    expect(guidance.targetMarginRate).toBe('0.750000');
  });

  it('publishes against the seller’s own destination, not the platform fallback', async () => {
    const executor = executorReturning(PRODUCT, [variantRow()]);
    resolveProductPricingMock.mockResolvedValue(resolved(440));

    await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(resolveProductPricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketCode: 'AU' }),
    );
  });

  it('falls back to the platform destination when the seller has no profile', async () => {
    findActiveProfileForSellerMock.mockResolvedValue(null);
    const executor = executorReturning(PRODUCT, [variantRow()]);
    resolveProductPricingMock.mockResolvedValue(resolved(440));

    await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(resolveProductPricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketCode: 'PH' }),
    );
  });

  /**
   * A price a person set is theirs. The editor must keep showing it rather
   * than replacing it with a rule's number, and publication must keep sending
   * it as theirs.
   */
  it.each([
    {
      label: 'publish shape',
      offerDecision: { resolvedLayer: 'SELLER_RETAIL_PRICE' },
    },
    {
      label: 'draft-save shape',
      offerDecision: { source: 'SELLER_RETAIL_PRICE' },
    },
  ])('reports a price the seller set ($label)', async ({ offerDecision }) => {
    const executor = executorReturning(PRODUCT, [
      variantRow({
        offerDecision,
        offerResolverVersion: 'SELLER_RETAIL_PRICE_V1',
      }),
    ]);
    resolveProductPricingMock.mockResolvedValue(resolved(440));

    const [guidance] = await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(guidance.sellerOverridden).toBe(true);
  });

  it('carries the resolver’s own refusal rather than inventing a price', async () => {
    const executor = executorReturning(PRODUCT, [variantRow()]);
    resolveProductPricingMock.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'PRICING_POLICY_REQUIRED',
      reasonLabel:
        'No margin policy — set a store default or a category margin in Market rules',
      resolverVersion: 'pricing-resolver-v3',
    });

    const [guidance] = await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(guidance.suggestedPriceMinor).toBeNull();
    expect(guidance.unavailableLabel).toMatch(/No margin policy/);
  });

  it('passes a missing supplier cost through as null', async () => {
    const executor = executorReturning(PRODUCT, [
      variantRow({ costMinor: null, costCurrency: null }),
    ]);
    resolveProductPricingMock.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'SUPPLIER_COST_UNAVAILABLE',
      reasonLabel: 'Supplier cost unavailable',
      resolverVersion: 'pricing-resolver-v3',
    });

    await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(resolveProductPricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ supplierCost: null }),
    );
  });

  it('refuses to guess a destination when none is configured', async () => {
    findActiveProfileForSellerMock.mockResolvedValue(null);
    capabilitiesMock.mockReturnValue({ destinations: [] });
    const executor = executorReturning(PRODUCT, [variantRow()]);

    const [guidance] = await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(guidance.suggestedPriceMinor).toBeNull();
    expect(guidance.unavailableLabel).toMatch(/No destination/);
    expect(resolveProductPricingMock).not.toHaveBeenCalled();
  });

  it('answers nothing for a product this seller does not steward', async () => {
    const executor = executorReturning([], []);

    const guidance = await resolveEditorPricingGuidance(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
    });

    expect(guidance).toEqual([]);
    expect(resolveProductPricingMock).not.toHaveBeenCalled();
  });
});
