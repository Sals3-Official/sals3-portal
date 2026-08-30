import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import CatalogueRowActions from './CatalogueRowActions';

vi.mock('@/app/(portal)/listings/publish-actions', () => ({
  publishProductAction: vi.fn(),
  unpublishProductAction: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: vi.fn() }));

function product(
  overrides: Partial<CatalogueProductFixture> = {},
): CatalogueProductFixture {
  return {
    id: 'row-1',
    sals3ProductId: '11111111-1111-4111-8111-111111111111',
    name: 'Ice Silk Trousers',
    status: 'DRAFT',
    storefrontUrl: null,
    pauseReason: null,
    ...overrides,
  } as CatalogueProductFixture;
}

function renderActions(overrides: Partial<CatalogueProductFixture> = {}) {
  return render(
    <CatalogueRowActions
      product={product(overrides)}
      editHref="/listings/row-1"
      onPauseListing={vi.fn()}
      onArchive={vi.fn()}
    />,
  );
}

describe('CatalogueRowActions', () => {
  /**
   * Edit used to sit outside the menu as its own link, which made the Actions
   * column two controls wide on every row. It now leads the menu.
   */
  it('keeps no control beside More', () => {
    renderActions();

    expect(
      screen.getByRole('button', { name: /more actions/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  /**
   * A menu item that navigated by handler would look like a link and behave
   * like a button — no middle-click, no open-in-new-tab, no status bar. It is
   * an anchor with a real href.
   */
  it('offers Edit inside the menu as a real link', () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/listings/row-1',
    );
  });

  /** Pausing is offered only where there is something live to pause. */
  it('offers Pause on a live listing', () => {
    renderActions({ status: 'LIVE' });

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

    expect(
      screen.getByRole('menuitem', { name: 'Pause listing' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Publish to storefront' }),
    ).toBeNull();
  });

  /** And a draft is offered the opposite, never both. */
  it('offers Publish on a draft', () => {
    renderActions({ status: 'DRAFT' });

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

    expect(
      screen.getByRole('menuitem', { name: 'Publish to storefront' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Pause listing' }),
    ).toBeNull();
  });
});
