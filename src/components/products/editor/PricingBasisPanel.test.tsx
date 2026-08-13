import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PricingBasisPanel from './PricingBasisPanel';

describe('PricingBasisPanel', () => {
  it('blocks price guidance for an ambiguous category mapping, never inheriting a random policy', () => {
    render(
      <PricingBasisPanel
        categoryPath="Some Department > Something"
        categoryCode="CAT-XXX-000001"
        categoryMappingConfidence="AMBIGUOUS"
        variantGuidance={[
          { variantId: 'v1', optionLabel: 'Variant 1', decision: null },
        ]}
        overridesAvailable={false}
      />,
    );

    expect(
      screen.getByText(/No CJ category is on record for this product/i),
    ).toBeInTheDocument();
    // The per-variant grid never renders for a mapping that needs review.
    expect(screen.queryByText('Variant 1')).not.toBeInTheDocument();
  });

  it('shows a plain-language unavailable reason, never a fabricated price', () => {
    render(
      <PricingBasisPanel
        categoryPath="Digital Goods > Mobile Load"
        categoryCode="CAT-DIG-100801"
        categoryMappingConfidence="EXACT"
        variantGuidance={[
          {
            variantId: 'v1',
            optionLabel: 'Variant 1',
            decision: {
              outcome: 'PRICING_UNAVAILABLE',
              reason: 'CATEGORY_POLICY_REQUIRED',
              reasonLabel: 'Category policy required',
              resolverVersion: 'test',
            },
          },
        ]}
        overridesAvailable={false}
      />,
    );

    expect(screen.getByText('Category policy required')).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it('shows the resolved margin, suggested price, and source layer for a real estimate', () => {
    render(
      <PricingBasisPanel
        categoryPath="Digital Goods > Mobile Load"
        categoryCode="CAT-DIG-100801"
        categoryMappingConfidence="EXACT"
        variantGuidance={[
          {
            variantId: 'v1',
            optionLabel: 'Variant 1',
            decision: {
              outcome: 'PRODUCT_MARGIN_ESTIMATE',
              resolvedLayer: 'CATEGORY',
              categoryCode: 'CAT-DIG-100801',
              categoryPath: 'Digital Goods > Mobile Load',
              targetMarginRate: '0.300000',
              roundingRule: 'NONE',
              referenceFxRate: '1.000000',
              referenceFxSource: 'IDENTITY',
              referenceFxObservedAt: '2026-08-11T00:00:00.000Z',
              fundingBufferRate: '0.000000',
              fundingBufferPolicyId: 'buffer-1',
              fundingBufferPolicyVersion: 1,
              effectiveProductCost: { amountMinor: 1000, currency: 'USD' },
              suggestedItemPrice: { amountMinor: 1429, currency: 'USD' },
              roundedSuggestedItemPrice: { amountMinor: 1429, currency: 'USD' },
              categoryPolicyId: 'policy-1',
              categoryPolicyVersion: 1,
              productOverrideId: null,
              productOverrideVersion: null,
              variantOverrideId: null,
              variantOverrideVersion: null,
              supplierCostObservedAt: '2026-08-11T00:00:00.000Z',
              resolverVersion: 'test',
              scopeNote:
                'This is product-only price guidance; checkout freight is not included.',
            },
          },
        ]}
        overridesAvailable={false}
      />,
    );

    expect(screen.getByText('30.00%')).toBeInTheDocument();
    expect(screen.getByText('14.29 USD')).toBeInTheDocument();
    expect(screen.getByText('Category policy')).toBeInTheDocument();
  });

  it('tells the seller overrides need a saved candidate when the fixture has none', () => {
    render(
      <PricingBasisPanel
        categoryPath="Digital Goods > Mobile Load"
        categoryCode="CAT-DIG-100801"
        categoryMappingConfidence="EXACT"
        variantGuidance={[]}
        overridesAvailable={false}
      />,
    );

    expect(
      screen.getByText(/overrides need a saved supplier candidate/i),
    ).toBeInTheDocument();
  });
});
