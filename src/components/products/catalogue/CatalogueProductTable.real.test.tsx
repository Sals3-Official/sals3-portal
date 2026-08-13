import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import adaptRealRows from '@/lib/seller-center/product-catalogue/adapt-real';
import type { CatalogueVariantRowData } from '@/modules/catalog/products/catalogue-detail-queries';
import type { CatalogueListingRow } from '@/modules/catalog/products/catalogue-queries';
import CatalogueProductTable from './CatalogueProductTable';

/**
 * The rich table, rendered on REAL data through `adapt-real`.
 *
 * This exists because the local database is empty, so the one thing a browser
 * check cannot show is what the restored design looks like with real rows in it.
 * The assertions below are that view: every unmeasured column says "Not tracked
 * yet", the supplier facts that ARE recorded appear, and none of the
 * placeholders the owner rejected reach the DOM.
 */

const OBSERVED_AT = new Date('2026-08-01T10:00:00.000Z');

const ROW: CatalogueListingRow = {
  productId: '11111111-1111-4111-8111-111111111111',
  title: 'Folding Camp Chair',
  publicationState: 'UNPUBLISHED',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-02T00:00:00.000Z'),
  version: 1,
  categoryPath: null,
  brandName: null,
  providerCode: 'CJ',
  providerDisplayName: 'CJdropshipping',
  externalProductId: '17309882010211',
  sourceStatus: 'ACTIVE',
  syncState: 'STALE',
  lastObservedAt: OBSERVED_AT,
  variantCount: 1,
  revisionWorkflowState: 'DRAFT',
  connectionStatus: 'CONNECTED',
};

const VARIANT: CatalogueVariantRowData = {
  productId: ROW.productId,
  variantId: '22222222-2222-4222-8222-222222222222',
  sals3Sku: 'SALS3-0001',
  status: 'DRAFT',
  weightGrams: 900,
  sourceOptionLabel: 'Black-1XL',
  externalVariantId: 'CJ-V-1',
  lastObservedCostMinor: BigInt(1250),
  lastObservedCostCurrency: 'USD',
  lastObservedInventory: 42,
  lastObservedAt: OBSERVED_AT,
};

function renderTable(expanded: boolean) {
  const rows = adaptRealRows(
    [ROW],
    new Map([[ROW.productId, [VARIANT]]]),
    new Map(),
  );

  return render(
    <CatalogueProductTable
      rows={rows}
      selectedIds={new Set()}
      expandedIds={expanded ? new Set([ROW.productId]) : new Set()}
      onToggleSelected={vi.fn()}
      onToggleExpanded={vi.fn()}
      onAction={vi.fn()}
      onVariantAction={vi.fn()}
    />,
  );
}

describe('the rich catalogue table on real data', () => {
  it('says "Not tracked yet" for every unmeasured column', () => {
    renderTable(false);

    // Availability, Media, Attention, Content score and Selling Price - five
    // columns with no backing store, all stated rather than guessed.
    expect(
      screen.getAllByText('Not tracked yet').length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('shows the real title, supplier reference and evidence facts', () => {
    renderTable(false);

    expect(screen.getByText('Folding Camp Chair')).toBeInTheDocument();
    expect(
      screen.getByText(/CJdropshipping · CJ ID: 17309882010211/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Supplier-side status: ACTIVE'),
    ).toBeInTheDocument();
    expect(screen.getByText('Evidence: STALE')).toBeInTheDocument();
  });

  it('shows Draft, never a fictional lifecycle state', () => {
    renderTable(false);

    expect(screen.getByText('Draft')).toBeInTheDocument();
    ['Live · Needs Attention', 'Auto-paused'].forEach((fiction) => {
      expect(screen.queryByText(fiction)).toBeNull();
    });
  });

  it('renders no fabricated price, availability or all-clear text', () => {
    const { container } = renderTable(true);

    ['$0.00', 'Available', 'Clear', 'Own pictures'].forEach((placeholder) => {
      expect(container.textContent).not.toContain(placeholder);
    });
  });

  it('shows a variant observed cost and quantity as observations', () => {
    renderTable(true);

    expect(screen.getByText('Seller SKU: SALS3-0001')).toBeInTheDocument();
    expect(screen.getByText('Black-1XL')).toBeInTheDocument();
    expect(screen.getByText(/Supplier cost:/)).toBeInTheDocument();
    expect(
      screen.getByText(/Supplier-reported: 42 \(not a guaranteed promise\)/),
    ).toBeInTheDocument();
  });

  /** Pause must be present and explained, never silently missing. */
  it('renders the variant pause control disabled with its reason', () => {
    renderTable(true);

    const pause = screen.getByRole('button', { name: 'Pause variant' });

    expect(pause).toBeDisabled();
    expect(pause).toHaveAttribute(
      'title',
      expect.stringContaining('published'),
    );
  });
});
