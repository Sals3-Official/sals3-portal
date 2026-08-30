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
    name: 'Ice Silk Trousers',
    status: 'LIVE',
    storefrontUrl: null,
    pauseReason: null,
    sellingPrice: null,
    variants: [],
    attentionReasons: [],
    ...overrides,
  } as unknown as CatalogueProductFixture;
}

describe('ProductCatalogueWorkspace and server truth', () => {
  /**
   * The defect this covers.
   *
   * The screen keeps its rows in `useState` so the preview-only bulk actions
   * can move them, and `useState` ignores its argument after the first render.
   * So a real write — pausing a listing from the row menu, or a bulk publish —
   * reached the database, revalidated `/listings`, came back as new props, and
   * was discarded: the toast said the listing was paused while the row it named
   * still read Live until a hard reload.
   */
  it('adopts a new server list rather than keeping the first one', () => {
    const view = render(
      <ProductCatalogueWorkspace
        initialProducts={[product({ name: 'Ice Silk Trousers' })]}
      />,
    );

    expect(screen.getByText('Ice Silk Trousers')).toBeInTheDocument();

    view.rerender(
      <ProductCatalogueWorkspace
        initialProducts={[
          // Same status as the first, so the active tab cannot be what decides
          // whether the new row shows. This is about the list, not the filter.
          product({ id: 'row-2', name: 'Camouflage Jeans' }),
        ]}
      />,
    );

    expect(screen.getByText('Camouflage Jeans')).toBeInTheDocument();
    expect(screen.queryByText('Ice Silk Trousers')).toBeNull();
  });

  /**
   * Identity, not contents: a re-render that hands back the same array must not
   * reset anything, or every unrelated parent render would wipe the tab, the
   * filters and the selection.
   */
  it('leaves the list alone when the same one is handed back', () => {
    const list = [product({ name: 'Ice Silk Trousers' })];
    const view = render(<ProductCatalogueWorkspace initialProducts={list} />);

    view.rerender(<ProductCatalogueWorkspace initialProducts={list} />);

    expect(screen.getByText('Ice Silk Trousers')).toBeInTheDocument();
  });

  /**
   * The header box acts on what the tab and filters are showing, not on the
   * catalogue. Arming a bulk action against rows a seller never looked at is
   * how a bulk action becomes something nobody trusts — this one publishes.
   */
  it('selects every row shown, and clears them on a second press', () => {
    render(
      <ProductCatalogueWorkspace
        initialProducts={[
          product({ id: 'a', name: 'Ice Silk Trousers' }),
          product({ id: 'b', name: 'Camouflage Jeans' }),
        ]}
      />,
    );

    const selectAll = screen.getByRole('checkbox', { name: /select all/i });

    fireEvent.click(selectAll);
    expect(screen.getByText('2 listings selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /clear selection/i }));
    expect(screen.getByText('0 listings selected')).toBeInTheDocument();
  });

  /**
   * Everything on Live is already on the storefront, so Publish there is an
   * action with no subject. Hidden rather than disabled: nothing on that tab
   * would ever enable it.
   */
  it('offers no Publish button on the Live tab', () => {
    render(
      <ProductCatalogueWorkspace
        initialProducts={[
          product({ id: 'a', name: 'Ice Silk Trousers' }),
          product({ id: 'b', name: 'Camouflage Jeans', status: 'DRAFT' }),
        ]}
      />,
    );

    // Live is where this screen opens, so this is the first thing a seller sees.
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /^Draft/ }));

    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });
});
