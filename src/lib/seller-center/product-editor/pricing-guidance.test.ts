import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(() => ({ __db: true })),
  resolveProductPricing: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({ default: mocks.getDb }));
vi.mock('@/modules/pricing/resolver', () => ({
  resolveProductPricing: mocks.resolveProductPricing,
}));

/* eslint-disable import/first */
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import resolveFixtureVariantGuidance from './pricing-guidance';

function fixture() {
  const resolved = resolveProductEditorFixture('pass');
  if (resolved === null) throw new Error('missing fixture');
  return resolved;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveFixtureVariantGuidance', () => {
  it('returns one guidance entry per variant, calling the real resolver for each', async () => {
    mocks.resolveProductPricing.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'CATEGORY_POLICY_REQUIRED',
      reasonLabel: 'Category policy required',
      resolverVersion: 'test',
    });

    const guidance = await resolveFixtureVariantGuidance(fixture(), 'seller-1');

    expect(guidance).toHaveLength(fixture().variants.length);
    expect(mocks.resolveProductPricing).toHaveBeenCalledTimes(
      fixture().variants.length,
    );
    expect(mocks.resolveProductPricing).toHaveBeenCalledWith(
      { __db: true },
      expect.objectContaining({
        sellerAccountId: 'seller-1',
        settlementCurrency: 'USD',
      }),
    );
  });

  it('degrades to a null decision per variant rather than throwing when the resolver fails (e.g. an unmigrated schema)', async () => {
    mocks.resolveProductPricing.mockRejectedValue(
      new Error('relation "pricing_category_policies" does not exist'),
    );

    const guidance = await resolveFixtureVariantGuidance(fixture(), 'seller-1');

    expect(guidance.every((entry) => entry.decision === null)).toBe(true);
    expect(guidance).toHaveLength(fixture().variants.length);
  });
});
