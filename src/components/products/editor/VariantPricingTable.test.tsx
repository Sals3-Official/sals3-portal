import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VariantFixture } from '@/lib/seller-center/product-editor/types';
import VariantPricingTable, {
  PricingWorkingLines,
} from './VariantPricingTable';

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
  /**
   * The line under each rule-priced cell is gone (owner report 2026-08-28): it
   * repeated on every row what the column header now says once, and a locked
   * cell already announces that the rules own the number. The category and the
   * markup still reach the seller — through the header working, asserted below.
   */
  it('says nothing under a rule-priced cell', () => {
    renderWith([
      {
        variantId: 'variant-1',
        suggestedPrice: { amountMinor: 3499, currency: 'USD' },
        unavailableLabel: null,
        sourceCategoryPath: 'Apparel & Accessories > Clothing Accessories',
        markupPercent: 300,
        sellerOverridden: false,
        effectiveCost: { amountMinor: 1100, currency: 'USD' },
        fundingBufferPercent: 1.5,
        marginPercent: 75,
        priceBeforeRounding: null,
        contributionFloorApplied: false,
      },
    ]);

    expect(
      screen.queryByText(
        'From 300% markup on Apparel & Accessories > Clothing Accessories',
      ),
    ).toBeNull();
    expect(screen.queryByText(/From .* markup/)).toBeNull();
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
            effectiveCost: { amountMinor: 1100, currency: 'USD' },
            fundingBufferPercent: 1.5,
            marginPercent: 75,
            priceBeforeRounding: null,
            contributionFloorApplied: false,
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
          effectiveCost: { amountMinor: 1100, currency: 'USD' },
          fundingBufferPercent: 1.5,
          marginPercent: 75,
          priceBeforeRounding: null,
          contributionFloorApplied: false,
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
        effectiveCost: null,
        fundingBufferPercent: null,
        marginPercent: null,
        priceBeforeRounding: null,
        contributionFloorApplied: false,
      },
    ]);

    expect(screen.getByText(/No margin policy/)).toBeInTheDocument();
  });

  /**
   * The owner asked "saan galing yung 75?" of a 33.33% markup, which is the
   * right question of a figure that will not reconcile: cost x 1.3333 does not
   * reproduce the price, because the funding buffer is added first.
   */
  it('shows the working, step by step, in the resolver’s own order', () => {
    render(
      <PricingWorkingLines
        supplierCost={{ amountMinor: 580, currency: 'USD' }}
        guidance={{
          variantId: 'variant-1',
          suggestedPrice: { amountMinor: 785, currency: 'USD' },
          unavailableLabel: null,
          sourceCategoryPath: 'Apparel & Accessories > Clothing',
          markupPercent: 33.33,
          sellerOverridden: false,
          effectiveCost: { amountMinor: 589, currency: 'USD' },
          fundingBufferPercent: 1.5,
          marginPercent: 25,
          priceBeforeRounding: null,
          contributionFloorApplied: false,
        }}
      />,
    );

    expect(screen.getByText('Supplier cost')).toBeInTheDocument();
    expect(screen.getByText('$5.80')).toBeInTheDocument();
    expect(screen.getByText('+ 1.5% funding buffer')).toBeInTheDocument();
    expect(screen.getByText('$5.89')).toBeInTheDocument();
    expect(screen.getByText('÷ 0.75 (25% margin)')).toBeInTheDocument();
    expect(screen.getByText('$7.85')).toBeInTheDocument();
    // The answer to the question that prompted the whole control.
    expect(
      screen.getByText(/the cost is the other 75% — and 25 ÷ 75 = 33.33%/),
    ).toBeInTheDocument();
  });

  it('names the rounding step only when rounding moved the number', () => {
    const base = {
      variantId: 'variant-1',
      suggestedPrice: { amountMinor: 799, currency: 'USD' },
      unavailableLabel: null,
      sourceCategoryPath: 'Apparel & Accessories',
      markupPercent: 33.33,
      sellerOverridden: false,
      effectiveCost: { amountMinor: 589, currency: 'USD' },
      fundingBufferPercent: 1.5,
      marginPercent: 25,
      contributionFloorApplied: false,
    };

    const view = render(
      <PricingWorkingLines
        supplierCost={{ amountMinor: 580, currency: 'USD' }}
        guidance={{
          ...base,
          priceBeforeRounding: { amountMinor: 785, currency: 'USD' },
        }}
      />,
    );

    expect(screen.getByText('Rounded')).toBeInTheDocument();
    expect(screen.getByText('$7.99')).toBeInTheDocument();

    view.rerender(
      <PricingWorkingLines
        supplierCost={{ amountMinor: 580, currency: 'USD' }}
        guidance={{ ...base, priceBeforeRounding: null }}
      />,
    );

    expect(screen.queryByText('Rounded')).toBeNull();
  });

  /** Saying "from 33.33% markup" would be a lie when the floor set the price. */
  it('says when the contribution floor set the price instead of the margin', () => {
    render(
      <PricingWorkingLines
        supplierCost={{ amountMinor: 580, currency: 'USD' }}
        guidance={{
          variantId: 'variant-1',
          suggestedPrice: { amountMinor: 900, currency: 'USD' },
          unavailableLabel: null,
          sourceCategoryPath: 'Apparel & Accessories',
          markupPercent: 33.33,
          sellerOverridden: false,
          effectiveCost: { amountMinor: 589, currency: 'USD' },
          fundingBufferPercent: 1.5,
          marginPercent: 25,
          priceBeforeRounding: null,
          contributionFloorApplied: true,
        }}
      />,
    );

    expect(
      screen.getByText(/minimum contribution floor set this price/),
    ).toBeInTheDocument();
  });

  it('offers the explainer on a control a keyboard can reach', () => {
    render(
      <VariantPricingTable
        variants={[VARIANT]}
        pricingGuidance={[
          {
            variantId: 'variant-1',
            suggestedPrice: { amountMinor: 785, currency: 'USD' },
            unavailableLabel: null,
            sourceCategoryPath: 'Apparel & Accessories > Clothing',
            markupPercent: 33.33,
            sellerOverridden: false,
            effectiveCost: { amountMinor: 589, currency: 'USD' },
            fundingBufferPercent: 1.5,
            marginPercent: 25,
            priceBeforeRounding: null,
            contributionFloorApplied: false,
          },
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
      screen.getByRole('button', { name: 'How this price is worked out' }),
    ).toBeInTheDocument();
  });

  it('offers no explainer when the rules could not price the variant', () => {
    render(
      <VariantPricingTable
        variants={[VARIANT]}
        pricingGuidance={[
          {
            variantId: 'variant-1',
            suggestedPrice: null,
            unavailableLabel: 'Supplier cost unavailable',
            sourceCategoryPath: null,
            markupPercent: null,
            sellerOverridden: false,
            effectiveCost: null,
            fundingBufferPercent: null,
            marginPercent: null,
            priceBeforeRounding: null,
            contributionFloorApplied: false,
          },
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
      screen.queryByRole('button', { name: 'How this price is worked out' }),
    ).toBeNull();
  });

  it('says nothing at all when no rule was resolved for this variant', () => {
    renderWith([]);

    expect(screen.queryByText(/From /)).toBeNull();
    expect(screen.queryByText(/Your price/)).toBeNull();
  });
  /**
   * The explainer shipped on every row, so a ten-variant product carried ten
   * copies of one identical sum. Owner report 2026-08-28: it belongs beside the
   * column heading, once.
   */
  describe('where the working is explained', () => {
    const guidanceFor = (variantId: string, costMinor: number) => ({
      variantId,
      suggestedPrice: { amountMinor: 1235, currency: 'USD' as const },
      unavailableLabel: null,
      sourceCategoryPath: 'Apparel & Accessories > Clothing',
      markupPercent: 33.33,
      sellerOverridden: false,
      effectiveCost: { amountMinor: costMinor, currency: 'USD' as const },
      fundingBufferPercent: 1.5,
      marginPercent: 25,
      priceBeforeRounding: null,
      contributionFloorApplied: false,
    });

    const second: VariantFixture = {
      ...VARIANT,
      id: 'variant-2',
      optionLabel: 'Color: Blue, Size: M',
      sellerSku: 'S3-BLU-M',
    };

    it('explains once for the whole column, not once per variant', () => {
      render(
        <VariantPricingTable
          variants={[VARIANT, second]}
          pricingGuidance={[
            guidanceFor('variant-1', 926),
            guidanceFor('variant-2', 926),
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

      // Two variants, one explainer.
      expect(
        screen.getAllByRole('button', {
          name: 'How this price is worked out',
        }),
      ).toHaveLength(1);
    });

    it('puts it in the Retail price column header', () => {
      render(
        <VariantPricingTable
          variants={[VARIANT]}
          pricingGuidance={[guidanceFor('variant-1', 926)]}
          expandedVariantId={null}
          onToggleExpanded={vi.fn()}
          onToggleEnabled={vi.fn()}
          onRetailChange={vi.fn()}
          onUseRulePrice={vi.fn()}
          onSellerSkuChange={vi.fn()}
          onBulkSetPrice={vi.fn()}
        />,
      );

      const header = screen
        .getAllByRole('columnheader')
        .find((cell) => cell.textContent?.includes('Retail price'));

      expect(header).toBeDefined();
      expect(
        header?.querySelector('[aria-label="How this price is worked out"]'),
      ).not.toBeNull();
    });

    /**
     * One variant's arithmetic must not stand in for a column whose costs
     * differ: the header would state a number that is wrong for most rows.
     */
    it('says nothing in the header when the variants do not share one sum', () => {
      render(
        <VariantPricingTable
          variants={[VARIANT, second]}
          pricingGuidance={[
            guidanceFor('variant-1', 926),
            guidanceFor('variant-2', 1400),
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
        screen.queryByRole('button', {
          name: 'How this price is worked out',
        }),
      ).toBeNull();
    });
  });
  /**
   * Owner decision 2026-08-28: the margin rules are where a price comes from,
   * so typing over one has to be deliberate. The cell reads as text until
   * somebody asks for the pencil.
   */
  describe('locking a rule-derived price', () => {
    const ruleGuidance = {
      variantId: 'variant-1',
      suggestedPrice: { amountMinor: 1235, currency: 'USD' as const },
      unavailableLabel: null,
      sourceCategoryPath: 'Apparel & Accessories > Clothing',
      markupPercent: 33.33,
      sellerOverridden: false,
      effectiveCost: { amountMinor: 926, currency: 'USD' as const },
      fundingBufferPercent: 1.5,
      marginPercent: 25,
      priceBeforeRounding: null,
      contributionFloorApplied: false,
    };

    function renderLockable(
      guidance: Parameters<typeof VariantPricingTable>[0]['pricingGuidance'],
      variant: VariantFixture = VARIANT,
      onRequestPriceUnlock = vi.fn(),
    ) {
      render(
        <VariantPricingTable
          variants={[variant]}
          pricingGuidance={guidance}
          onRequestPriceUnlock={onRequestPriceUnlock}
          expandedVariantId={null}
          onToggleExpanded={vi.fn()}
          onToggleEnabled={vi.fn()}
          onRetailChange={vi.fn()}
          onUseRulePrice={vi.fn()}
          onSellerSkuChange={vi.fn()}
          onBulkSetPrice={vi.fn()}
        />,
      );

      return onRequestPriceUnlock;
    }

    it('shows the number as text, not a field, when the rules priced it', () => {
      renderLockable([ruleGuidance]);

      const label = `Retail price for ${VARIANT.optionLabel}`;

      expect(screen.getByLabelText(label).tagName).not.toBe('INPUT');
      expect(
        screen.getByRole('button', { name: `Override ${label}` }),
      ).toBeInTheDocument();
    });

    it('asks to unlock rather than unlocking itself', () => {
      // The table never decides: the workspace owns the reason, so the pencil
      // reports intent and nothing about the cell changes until it says so.
      const onRequestPriceUnlock = renderLockable([ruleGuidance]);

      screen
        .getByRole('button', {
          name: `Override Retail price for ${VARIANT.optionLabel}`,
        })
        .click();

      expect(onRequestPriceUnlock).toHaveBeenCalledWith(VARIANT.id);
    });

    it('leaves a price a person already owns editable', () => {
      // Not the rules' number, so there is nothing to guard against losing.
      renderLockable([{ ...ruleGuidance, sellerOverridden: true }], {
        ...VARIANT,
        retailPriceIsSellerSet: true,
      });

      expect(
        screen.getByLabelText(`Retail price for ${VARIANT.optionLabel}`)
          .tagName,
      ).toBe('INPUT');
    });

    it('leaves a variant the rules cannot price editable', () => {
      /*
        Locking this one would block publication on the very field it is asking
        the seller to fill in.
      */
      renderLockable([
        {
          ...ruleGuidance,
          suggestedPrice: null,
          unavailableLabel: 'Supplier cost unavailable',
          markupPercent: null,
          marginPercent: null,
          effectiveCost: null,
        },
      ]);

      expect(
        screen.getByLabelText(`Retail price for ${VARIANT.optionLabel}`)
          .tagName,
      ).toBe('INPUT');
    });

    it('stays editable where no save can record the override', () => {
      // Fixture and design-preview mode: ceremony with nothing behind it.
      render(
        <VariantPricingTable
          variants={[VARIANT]}
          pricingGuidance={[ruleGuidance]}
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
        screen.getByLabelText(`Retail price for ${VARIANT.optionLabel}`)
          .tagName,
      ).toBe('INPUT');
    });
  });
  /**
   * Owner report 2026-08-28: clearing the cell looked like it did something and
   * did not. It sent nothing, which a draft save read as no change and
   * publication read as "resolve from the rules" — the same gesture doing
   * nothing or everything depending on which button came next.
   */
  describe('handing a price back to the rules', () => {
    const sellerSet: VariantFixture = {
      ...VARIANT,
      retailPriceIsSellerSet: true,
    };

    const guidance = [
      {
        variantId: 'variant-1',
        suggestedPrice: { amountMinor: 1527, currency: 'USD' as const },
        unavailableLabel: null,
        sourceCategoryPath: 'Apparel & Accessories > Clothing',
        markupPercent: 33.33,
        sellerOverridden: true,
        effectiveCost: { amountMinor: 1145, currency: 'USD' as const },
        fundingBufferPercent: 1.5,
        marginPercent: 25,
        priceBeforeRounding: null,
        contributionFloorApplied: false,
      },
    ];

    function renderSellerSet(onUseRulePrice = vi.fn()) {
      render(
        <VariantPricingTable
          variants={[sellerSet]}
          pricingGuidance={guidance}
          expandedVariantId={null}
          onToggleExpanded={vi.fn()}
          onToggleEnabled={vi.fn()}
          onRetailChange={vi.fn()}
          onUseRulePrice={onUseRulePrice}
          onSellerSkuChange={vi.fn()}
          onBulkSetPrice={vi.fn()}
        />,
      );

      return onUseRulePrice;
    }

    it('treats an emptied field as a request for the rule price', () => {
      const onUseRulePrice = renderSellerSet();
      const field = screen.getByLabelText(
        `Retail price for ${VARIANT.optionLabel}`,
      );

      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: '' } });
      fireEvent.blur(field);

      expect(onUseRulePrice).toHaveBeenCalledWith(VARIANT.id);
    });

    it('does not revert while the field is still being typed in', () => {
      // Clearing to retype passes through empty. Reverting there would snap the
      // rules' number in under the caret.
      const onUseRulePrice = renderSellerSet();
      const field = screen.getByLabelText(
        `Retail price for ${VARIANT.optionLabel}`,
      );

      fireEvent.focus(field);
      fireEvent.change(field, { target: { value: '' } });

      expect(onUseRulePrice).not.toHaveBeenCalled();
    });

    it('offers a product-level hand-back only when one is wired', () => {
      const onHandAllBackToRules = vi.fn();

      render(
        <VariantPricingTable
          variants={[sellerSet]}
          pricingGuidance={guidance}
          onHandAllBackToRules={onHandAllBackToRules}
          expandedVariantId={null}
          onToggleExpanded={vi.fn()}
          onToggleEnabled={vi.fn()}
          onRetailChange={vi.fn()}
          onUseRulePrice={vi.fn()}
          onSellerSkuChange={vi.fn()}
          onBulkSetPrice={vi.fn()}
        />,
      );

      screen.getByRole('button', { name: 'Use my rules for all' }).click();

      expect(onHandAllBackToRules).toHaveBeenCalled();
    });

    it('hides it when nothing is overridden', () => {
      // A control that would change nothing reads as "already done".
      renderSellerSet();

      expect(
        screen.queryByRole('button', { name: 'Use my rules for all' }),
      ).toBeNull();
    });
  });
});
