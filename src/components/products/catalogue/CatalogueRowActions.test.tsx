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

  /**
   * A real, working link once the row has a real address — not the
   * stubbed-toast handler every other unbuilt action here still uses.
   */
  it('opens View Live Page at the real storefront address, in a new tab', () => {
    renderActions({
      status: 'LIVE',
      storefrontUrl: 'https://sals3-ecommerce.vercel.app/p/ice-silk-trousers',
    });

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

    const link = screen.getByRole('menuitem', { name: 'View Live Page' });

    expect(link).toHaveAttribute(
      'href',
      'https://sals3-ecommerce.vercel.app/p/ice-silk-trousers',
    );
    expect(link).toHaveAttribute('target', '_blank');
    // Leaving the portal for another origin without this is a reverse
    // tabnabbing hole, and `rel` on an `<a>` is easy to drop on a rewrite.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('disables View Live Page on a listing with no storefront address, live status alone is not enough', () => {
    // Guards against trusting `status` on its own: a live status with a null
    // address must still refuse to link anywhere, not fall back to `#` or an
    // `undefined` href a screen reader would still announce as a link.
    renderActions({ status: 'LIVE', storefrontUrl: null });

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

    expect(
      screen.getByRole('menuitem', { name: /View Live Page/ }),
    ).toHaveAttribute('data-disabled');
  });

  it('offers View Live Page for a live-needs-attention listing, not only a plain live one', () => {
    // `LIVE_NEEDS_ATTENTION` is still genuinely published — attention reasons
    // flag it, they do not unpublish it — so it must not be treated as if it
    // were a draft with nowhere to send the seller.
    renderActions({
      status: 'LIVE_NEEDS_ATTENTION',
      storefrontUrl: 'https://sals3-ecommerce.vercel.app/p/ice-silk-trousers',
    });

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));

    expect(
      screen.getByRole('menuitem', { name: 'View Live Page' }),
    ).toHaveAttribute(
      'href',
      'https://sals3-ecommerce.vercel.app/p/ice-silk-trousers',
    );
  });
});
