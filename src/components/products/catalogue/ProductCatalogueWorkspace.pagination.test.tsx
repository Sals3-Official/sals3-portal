import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import ProductCatalogueWorkspace from './ProductCatalogueWorkspace';

vi.mock('@/app/(portal)/listings/publish-actions', () => ({
  publishProductAction: vi.fn(),
  unpublishProductAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn() }),
}));

function product(
  overrides: Partial<CatalogueProductFixture> = {},
): CatalogueProductFixture {
  return {
    id: 'row-1',
    sals3ProductId: '11111111-1111-4111-8111-111111111111',
    name: 'Product 1',
    status: 'LIVE',
    storefrontUrl: null,
    pauseReason: null,
    sellingPrice: null,
    variants: [],
    attentionReasons: [],
    ...overrides,
  } as unknown as CatalogueProductFixture;
}

/** 30 rows, so the default 25-per-page splits it across two pages. */
function manyProducts(
  count: number,
  statusOverride?: CatalogueProductFixture['status'],
) {
  return Array.from({ length: count }, (_, index) =>
    product({
      id: `row-${index + 1}`,
      name: `Product ${index + 1}`,
      ...(statusOverride === undefined ? {} : { status: statusOverride }),
    }),
  );
}

describe('ProductCatalogueWorkspace pagination', () => {
  /**
   * The core promise: a large catalogue no longer renders every row at once.
   * 30 rows past the default 25-per-page must leave 5 unrendered on page 1.
   */
  it('renders only one page of rows by default', () => {
    render(<ProductCatalogueWorkspace initialProducts={manyProducts(30)} />);

    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.getByText('Product 25')).toBeInTheDocument();
    expect(screen.queryByText('Product 26')).toBeNull();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('30 products')).toBeInTheDocument();
  });

  it('reveals the remaining rows on the next page', () => {
    render(<ProductCatalogueWorkspace initialProducts={manyProducts(30)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(screen.queryByText('Product 1')).toBeNull();
    expect(screen.getByText('Product 26')).toBeInTheDocument();
    expect(screen.getByText('Product 30')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('shows every row on one page once the page size covers the whole list', async () => {
    render(<ProductCatalogueWorkspace initialProducts={manyProducts(30)} />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Rows per page' }));

    const option = await screen.findByRole('option', { name: '50 / page' });

    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.getByText('Product 30')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  /**
   * Switching tab narrows the filtered set. Staying on a page number that no
   * longer exists for the new scope must not show an empty table.
   */
  it('returns to page 1 when the active tab changes', () => {
    render(
      <ProductCatalogueWorkspace
        initialProducts={[
          ...manyProducts(30, 'LIVE'),
          product({ id: 'draft-1', name: 'Only Draft', status: 'DRAFT' }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /^Draft/ }));

    expect(screen.getByText('Only Draft')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('still shows the count on a single page, only hiding the nav when the scope is empty', () => {
    render(<ProductCatalogueWorkspace initialProducts={[product()]} />);

    // One product is still a real count worth showing, even with nowhere to
    // page to — matching how the Candidate Pipeline's own pager behaves.
    expect(
      screen.getByRole('navigation', { name: 'Product Catalogue pages' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();

    // The Draft tab has nothing in it for this fixture, so the nav has
    // nothing left to count and must not render "0 / 0" or similar.
    fireEvent.click(screen.getByRole('tab', { name: /^Draft/ }));

    expect(
      screen.queryByRole('navigation', { name: 'Product Catalogue pages' }),
    ).toBeNull();
  });
});
