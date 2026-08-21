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
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('switch', { name: `List ${VARIANT.optionLabel}` }),
    );

    expect(onToggleEnabled).toHaveBeenCalledWith(VARIANT.id);
  });

  it('splits a mapped Variant Matrix label into per-axis chips', () => {
    render(
      <VariantPricingTable
        variants={[VARIANT]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    expect(screen.getByText('Color: Black')).toBeInTheDocument();
    expect(screen.getByText('Size: M')).toBeInTheDocument();
  });

  it('renders an unmapped raw supplier label as plain text', () => {
    render(
      <VariantPricingTable
        variants={[{ ...VARIANT, optionLabel: 'Army Green-XL' }]}
        expandedVariantId={null}
        onToggleExpanded={vi.fn()}
        onToggleEnabled={vi.fn()}
        onRetailChange={vi.fn()}
        onSellerSkuChange={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    expect(screen.getByText('Army Green-XL')).toBeInTheDocument();
  });
});
