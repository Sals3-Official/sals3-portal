import { render, screen } from '@testing-library/react';
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
        onBulkEnableInStock={vi.fn()}
        onBulkDisableUnavailable={vi.fn()}
        onBulkSetPrice={vi.fn()}
      />,
    );

    expect(screen.getByText('$12.99')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(
      screen.getAllByText('Observed Aug 8, 2026, 6:05 AM UTC'),
    ).toHaveLength(2);
    expect(
      screen.getByText(/stored supplier evidence only/),
    ).toBeInTheDocument();
  });
});
