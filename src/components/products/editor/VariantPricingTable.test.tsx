import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VariantFixture } from '@/lib/seller-center/product-editor/types';
import VariantPricingTable from './VariantPricingTable';

const VARIANT: VariantFixture = {
  id: 'variant-1',
  optionLabel: 'Color: Black, Size: M',
  sellerSku: 'S3-BLK-M',
  supplierCost: { amountMinor: 1299, currency: 'USD' },
  retailPrice: { amountMinor: 3499, currency: 'USD' },
  supplierStock: 42,
  warehouseLabel: 'CJ warehouse',
  hasImage: true,
  enabled: true,
  listingState: 'WILL_LIST',
  attention: null,
  supplierVariantId: 'CJVID-1',
  packedWeightGrams: 410,
  evidenceCapturedAt: '2026-08-08T06:05:00.000Z',
};

describe('VariantPricingTable', () => {
  it('shows observed-at timestamps beside supplier cost and stock without refreshing supplier evidence', () => {
    render(
      <VariantPricingTable
        variants={[VARIANT]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onUseRulePrice={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    expect(screen.getByText('$12.99')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(
      screen.getAllByText('Observed Aug 8, 2026, 6:05 AM UTC'),
    ).toHaveLength(2);
    // The footnote names the recessed columns, because the recess is the only
    // thing on screen saying those two numbers are not fields.
    expect(
      screen.getByText(/shaded columns are stored supplier evidence/),
    ).toBeInTheDocument();
  });

  it('lists an enabled variant with an on switch, not a checkbox', () => {
    render(
      <VariantPricingTable
        variants={[VARIANT]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onUseRulePrice={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    const toggle = screen.getByRole('switch', {
      name: `List ${VARIANT.optionLabel}`,
    });

    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onToggleEnabled when the switch is flipped', () => {
    const onToggleEnabled = vi.fn();

    render(
      <VariantPricingTable
        variants={[VARIANT]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={onToggleEnabled}
        onRetailChange={vi.fn()}
        onUseRulePrice={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('switch', { name: `List ${VARIANT.optionLabel}` }),
    );

    expect(onToggleEnabled).toHaveBeenCalledWith(VARIANT.id);
  });

  it('leads the row with the first axis and gives the second its own column', () => {
    render(
      <VariantPricingTable
        variants={[VARIANT]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onUseRulePrice={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    const headers = screen
      .getAllByRole('columnheader')
      .map((node) => node.textContent);

    // `Colour` leads; `Image` is gone because the rail carries the photo. The
    // axis name is the header, so the cell never repeats `Color: Black`.
    expect(headers).toEqual([
      'Color',
      'List',
      'Size',
      'Sals3 SKU',
      'Supplier cost',
      '•Retail price',
      'Supplier stock',
      'Attention',
      'Supplier evidence',
    ]);
    expect(screen.getByRole('cell', { name: 'M' })).toBeInTheDocument();
    expect(screen.queryByText('Color: Black')).toBeNull();

    // The rail says the colour and how many of the second axis it carries.
    const rail = screen.getAllByRole('cell')[0];

    expect(rail?.textContent).toContain('Black');
    expect(rail?.textContent).toContain('1 × Size');
  });

  it('keeps one Variant column when the rows disagree about their axes', () => {
    // Columns taken from the first row would drop a value from any row shaped
    // differently, with nothing on screen saying a column is missing.
    render(
      <VariantPricingTable
        variants={[
          VARIANT,
          { ...VARIANT, id: 'variant-2', optionLabel: 'Color: Camel' },
        ]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onUseRulePrice={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('columnheader', { name: 'Variant' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('cell', { name: 'Color: Black, Size: M' }),
    ).toBeInTheDocument();
  });

  it('renders an unmapped raw supplier label as plain text', () => {
    render(
      <VariantPricingTable
        variants={[{ ...VARIANT, optionLabel: 'Army Green-XL' }]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onUseRulePrice={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    expect(screen.getByText('Army Green-XL')).toBeInTheDocument();
  });
});

describe('the rule behind the price', () => {
  function renderWith(
    guidance: Parameters<typeof VariantPricingTable>[0]['pricingGuidance'],
    variant: VariantFixture = VARIANT,
  ) {
    return render(
      <VariantPricingTable
        variants={[variant]}
        pricingGuidance={guidance}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onUseRulePrice={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );
  }

  /**
   * Before this line existed, a seller could set a department to 300% and had
   * no way to tell whether it had reached a given product: the rate lived only
   * on Market rules and the price lived only here.
   */
  it('names the markup and the category the rule sits on', () => {
    renderWith([
      {
        variantId: 'variant-1',
        suggestedPrice: { amountMinor: 3499, currency: 'USD' },
        unavailableLabel: null,
        sourceCategoryPath: 'Apparel & Accessories > Clothing Accessories',
        markupPercent: 300,
        sellerOverridden: false,
      },
    ]);

    expect(
      screen.getByText(
        'From 300% markup on Apparel & Accessories > Clothing Accessories',
      ),
    ).toBeInTheDocument();
  });

  /**
   * The way back. Every price entered before this screen resolved anything is
   * stamped as the seller's, so without this an existing catalogue could never
   * be handed back to its own margin rules.
   */
  it('offers a seller-set price back to the rules, and clears the flag when taken', () => {
    const onUseRulePrice = vi.fn();

    render(
      <VariantPricingTable
        variants={[{ ...VARIANT, retailPriceIsSellerSet: true }]}
        pricingGuidance={[
          {
            variantId: 'variant-1',
            suggestedPrice: { amountMinor: 4400, currency: 'USD' },
            unavailableLabel: null,
            sourceCategoryPath: 'Apparel & Accessories',
            markupPercent: 300,
            sellerOverridden: true,
          },
        ]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onUseRulePrice={onUseRulePrice}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Use $44.00 from your rules' }),
    );

    expect(onUseRulePrice).toHaveBeenCalledWith('variant-1');
  });

  it('says a price is the seller’s own, and that rules will not move it', () => {
    renderWith(
      [
        {
          variantId: 'variant-1',
          suggestedPrice: { amountMinor: 3499, currency: 'USD' },
          unavailableLabel: null,
          sourceCategoryPath: 'Apparel & Accessories',
          markupPercent: 300,
          sellerOverridden: true,
        },
      ],
      { ...VARIANT, retailPriceIsSellerSet: true },
    );

    expect(
      screen.getByText('Your price — margin rules do not change it'),
    ).toBeInTheDocument();
  });

  it('carries the resolver’s own refusal rather than a blank cell', () => {
    renderWith([
      {
        variantId: 'variant-1',
        suggestedPrice: null,
        unavailableLabel:
          'No margin policy — set a store default or a category margin in Market rules',
        sourceCategoryPath: null,
        markupPercent: null,
        sellerOverridden: false,
      },
    ]);

    expect(screen.getByText(/No margin policy/)).toBeInTheDocument();
  });

  it('says nothing at all when no rule was resolved for this variant', () => {
    renderWith([]);

    expect(screen.queryByText(/From /)).toBeNull();
    expect(screen.queryByText(/Your price/)).toBeNull();
  });
});
