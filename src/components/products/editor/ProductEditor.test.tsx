import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import type {
  EditorLifecycle,
  ProductEditorFixture,
} from '@/lib/seller-center/product-editor/types';
import ProductEditor from './ProductEditor';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

function fixture(key: string): ProductEditorFixture {
  const resolved = resolveProductEditorFixture(key);

  if (resolved === null) throw new Error(`missing fixture ${key}`);

  return resolved;
}

function renderEditor(key: string, lifecycle: EditorLifecycle = 'IDLE') {
  return render(
    <ProductEditor fixture={fixture(key)} initialLifecycle={lifecycle} />,
  );
}

function openSourceChangesTab() {
  fireEvent.click(screen.getByRole('tab', { name: /Source Changes/ }));
}

function publishButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Publish/ }) as HTMLButtonElement;
}

describe('Product Editor - publication outcomes', () => {
  it('offers Publish Product on a clean pass', () => {
    renderEditor('pass');

    const button = publishButton();

    expect(button).toHaveTextContent('Publish Product');
    expect(button).toBeEnabled();
    expect(
      screen.getByText(/No blockers and no warnings/i),
    ).toBeInTheDocument();
  });

  it('offers Publish with Attention and says the warnings survive publication', () => {
    renderEditor('attention');

    expect(publishButton()).toHaveTextContent('Publish with Attention');
    expect(publishButton()).toBeEnabled();
    expect(
      screen.getByText(/will remain after\s+publication/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No item-by-item approval is required/i),
    ).toBeInTheDocument();
  });

  it('never lets a blocked product look publishable, and states why', () => {
    renderEditor('blocked');

    const button = publishButton();

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '3 hard blockers must clear first');
    // The reason is on screen too, not only in a tooltip.
    expect(
      screen.getAllByText('3 hard blockers must clear first').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Publishing is disabled')).toBeInTheDocument();
  });
});

describe('Product Editor - required vs recommended attributes', () => {
  it('renders a missing required attribute as a hard blocker', () => {
    renderEditor('blocked');

    expect(
      screen.getByText(/Publication requires this\. It is a hard blocker/i),
    ).toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
  });

  it('renders a missing recommended attribute as a still-publishable warning', () => {
    renderEditor('attention');

    expect(
      screen.getByText(/Publishing is not blocked, and the attribute stays/i),
    ).toBeInTheDocument();
    expect(publishButton()).toBeEnabled();
  });
});

describe('Product Editor - money that is not known', () => {
  it('shows missing freight as a route check and missing margin as unavailable', () => {
    renderEditor('blocked');

    expect(screen.getAllByText('Needs route check').length).toBe(6);
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });

  it('never renders an unknown amount as zero', () => {
    const { container } = renderEditor('blocked');

    expect(container.textContent).not.toContain('$0.00');
  });

  it('shows the supplier source currency', () => {
    renderEditor('pass');

    expect(screen.getByText('Source currency')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
  });
});

describe('Product Editor - supplier identity', () => {
  it('names the provider, the connected account and the external product id', () => {
    renderEditor('pass');

    expect(screen.getAllByText('CJ Dropshipping').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CJPD2291845007').length).toBeGreaterThan(0);
  });

  it('surfaces a degraded connection rather than hiding it', () => {
    renderEditor('stale-evidence');

    expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0);
  });
});

describe('Product Editor - markets', () => {
  it('states that other markets are not evaluated instead of rendering them as evidence', () => {
    renderEditor('pass');

    expect(
      screen.getByText(
        'Other markets are not evaluated because they are not enabled for this seller.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Not enabled for this seller/)).toBeNull();
  });

  it('carries the checkout revalidation copy verbatim', () => {
    renderEditor('pass');

    expect(
      screen.getByText(/revalidated at checkout using the customer's actual/i),
    ).toBeInTheDocument();
  });
});

describe('Product Editor - what must not be on screen', () => {
  it('does not leak the internal checkout engineering note', () => {
    const { container } = renderEditor('delisted');

    openSourceChangesTab();

    expect(container.textContent).not.toMatch(/design annotation/i);
    expect(container.textContent).not.toContain('OrderLineSnapshot');
    expect(container.textContent).not.toContain('ADR-007');
  });

  it('keeps accepted-order wording distinct from current-listing impact', () => {
    renderEditor('delisted');

    openSourceChangesTab();

    expect(
      screen.getByText(/Current listing: paused automatically/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Accepted orders are unaffected/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It never rewrites an accepted order/i),
    ).toBeInTheDocument();
  });

  it('exposes no credential anywhere in the rendered screen', () => {
    const { container } = renderEditor('pass');

    expect(container.textContent).not.toMatch(
      /(api[_-]?key|access[_-]?token|refresh[_-]?token|bearer )/i,
    );
  });
});

describe('Product Editor - preview and panels', () => {
  it('renders a non-functional Add to Cart', () => {
    renderEditor('pass');

    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
  });

  it('says plainly that the data is fictional and unsaved', () => {
    renderEditor('pass');

    expect(
      screen.getByText(/UI preview using fictional product data/i),
    ).toBeInTheDocument();
  });

  it('always offers the readiness and preview triggers, at any width', () => {
    renderEditor('pass');

    expect(screen.getByRole('button', { name: 'Readiness' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Supplier Source Details' }),
    ).toBeVisible();
  });

  it('announces save and validation state politely', () => {
    const { container } = renderEditor('pass');
    const live = container.querySelector('[aria-live="polite"]');

    expect(live).not.toBeNull();
    expect(live?.textContent).toContain('No unsaved changes');
    expect(live?.textContent).toContain('Ready');
  });
});

describe('Product Editor - structure', () => {
  it('has exactly one page heading', () => {
    renderEditor('pass');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('flags the sections that carry an issue in the jump navigation', () => {
    renderEditor('blocked');

    const nav = screen.getByRole('navigation', { name: 'Editor sections' });

    expect(within(nav).getAllByText('Blocker').length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('marks each variant evidence row as collapsed until it is opened', () => {
    renderEditor('pass');

    screen
      .getAllByRole('button', { name: /^Supplier evidence for/ })
      .forEach((button) => {
        expect(button).toHaveAttribute('aria-expanded', 'false');
      });
  });

  it('states that a failed save kept the changes in the tab', () => {
    renderEditor('pass', 'SAVE_FAILED');

    expect(
      screen.getByText(/still here in this tab and will not be lost/i),
    ).toBeInTheDocument();
  });

  it('will not publish on an expired session, and says so', () => {
    renderEditor('pass', 'SESSION_EXPIRED');

    expect(screen.getByText('Your session expired')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Session expired - sign in again to publish/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Publish/ })).toBeDisabled();
  });

  it('names how many variants a bulk markup will skip before it runs', () => {
    // Every variant in `blocked` has lost its freight evidence, so none of
    // them has a landed cost to mark up.
    renderEditor('blocked');

    fireEvent.click(screen.getByRole('button', { name: 'Apply markup…' }));

    expect(screen.getByText(/Changes 0 variants/)).toBeInTheDocument();
    expect(screen.getByText(/Skips 6/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('lets the seller re-cover and reorder media locally', () => {
    renderEditor('pass');

    const media = screen.getByRole('region', { name: 'Media' });
    const items = within(media).getAllByRole('listitem');

    // The cover badge starts on the first tile and only ever sits on one.
    expect(within(items[0]).getByText('Cover')).toBeInTheDocument();
    expect(within(media).getAllByText('Cover')).toHaveLength(1);

    fireEvent.click(
      within(items[1]).getByRole('button', { name: 'Make cover' }),
    );

    expect(within(items[1]).getByText('Cover')).toBeInTheDocument();
    expect(within(media).getAllByText('Cover')).toHaveLength(1);
    expect(
      within(items[0]).getByRole('button', { name: 'Make cover' }),
    ).toBeInTheDocument();

    // Reordering is real and local: the first tile cannot move earlier.
    expect(
      within(items[0]).getByRole('button', { name: /Move .* earlier/ }),
    ).toBeDisabled();
    expect(
      within(items[0]).getByRole('button', { name: /Move .* later/ }),
    ).toBeEnabled();
  });

  it('never offers to replace a rejected image without an upload backend', () => {
    renderEditor('attention');

    const replace = screen.getByRole('button', { name: 'Replace' });

    expect(replace).toBeDisabled();
    expect(replace).toHaveAttribute(
      'title',
      expect.stringContaining('does not exist yet'),
    );
  });
});
