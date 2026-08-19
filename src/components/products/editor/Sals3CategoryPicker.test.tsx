import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Sals3CategoryPicker from './Sals3CategoryPicker';

const OPTIONS = [
  // Taxonomy v1 stores a row for every node, branches included — the two
  // branch rows below are what the branch-vs-leaf search tests rely on.
  { code: 'CAT-GGL-166', path: 'Apparel & Accessories' },
  { code: 'CAT-GGL-1604', path: 'Apparel & Accessories > Clothing' },
  {
    code: 'CAT-GGL-100230',
    path: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
  },
  { code: 'CAT-GGL-100', path: 'Luggage & Bags > Backpacks' },
  { code: 'CAT-GGL-200', path: 'Health & Beauty > Personal Care' },
];

function renderPicker(
  overrides: Partial<{
    currentPath: string | null;
    declaredBySeller: boolean;
    onSave: (
      code: string,
    ) => Promise<
      { ok: true; categoryPath: string } | { ok: false; message: string }
    >;
  }> = {},
) {
  const onSave =
    overrides.onSave ??
    vi.fn(async () => ({ ok: true as const, categoryPath: 'irrelevant' }));

  render(
    <Sals3CategoryPicker
      options={OPTIONS}
      currentPath={overrides.currentPath ?? null}
      declaredBySeller={overrides.declaredBySeller ?? true}
      onSave={onSave}
    />,
  );

  return { onSave };
}

function openPicker(): void {
  fireEvent.click(screen.getByRole('button', { name: /category/i }));
}

function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText(
    /Search the Sals3 v1 taxonomy/i,
  ) as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /^Save category$/,
  }) as HTMLButtonElement;
}

/** Drills Luggage & Bags > Backpacks, a two-level path ending in a leaf. */
function pickBackpacksByBrowsing(): void {
  openPicker();
  fireEvent.click(screen.getByText('Luggage & Bags'));
  fireEvent.click(screen.getByText('Backpacks'));
}

function pickJacketsBySearch(): void {
  openPicker();
  fireEvent.change(searchInput(), { target: { value: 'jackets' } });
  fireEvent.click(
    screen.getByText('Apparel & Accessories > Clothing > Outerwear > Jackets'),
  );
}

describe('Sals3CategoryPicker', () => {
  it('shows a placeholder and a "Choose category" button when nothing has ever been resolved', () => {
    renderPicker({ currentPath: null });

    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose category' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a compact, non-editable-looking value with a "Change category" button when a category is already resolved', () => {
    renderPicker({ currentPath: 'Luggage & Bags > Backpacks' });

    expect(screen.getByText('Luggage & Bags > Backpacks')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Change category' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens straight into a browsable department list — no typing required', () => {
    renderPicker({ currentPath: 'Luggage & Bags > Backpacks' });

    openPicker();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Apparel & Accessories')).toBeInTheDocument();
    expect(screen.getByText('Luggage & Bags')).toBeInTheDocument();
    expect(screen.getByText('Health & Beauty')).toBeInTheDocument();
  });

  it('drills down department by department to a leaf, and back up via the breadcrumb', () => {
    renderPicker();

    openPicker();
    fireEvent.click(screen.getByText('Apparel & Accessories'));

    expect(screen.getByText('Clothing')).toBeInTheDocument();
    expect(screen.queryByText('Luggage & Bags')).toBeNull();

    fireEvent.click(screen.getByText('All departments'));

    expect(screen.getByText('Luggage & Bags')).toBeInTheDocument();
  });

  it('selects a leaf reached purely by browsing, with no query ever typed, straight to a savable confirm step', () => {
    renderPicker();

    pickBackpacksByBrowsing();

    expect(screen.getByText('Luggage & Bags > Backpacks')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('still filters by substring across the whole tree when a query is typed, as a shortcut', () => {
    renderPicker();

    openPicker();
    fireEvent.change(searchInput(), { target: { value: 'jackets' } });

    expect(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Luggage & Bags > Backpacks')).toBeNull();
    expect(screen.queryByText('Health & Beauty > Personal Care')).toBeNull();
  });

  it('navigates into a branch search match instead of selecting it — the same rule browse mode enforces', () => {
    renderPicker();

    openPicker();
    fireEvent.change(searchInput(), { target: { value: 'clothing' } });
    fireEvent.click(screen.getByText('Apparel & Accessories > Clothing'));

    // Not a confirm step: no Save button appears for a branch.
    expect(
      screen.queryByRole('button', { name: /^Save category$/ }),
    ).toBeNull();
    // Instead the browser is now inside the branch, showing its children.
    expect(screen.getByText('Outerwear')).toBeInTheDocument();
    // And the search box is back to browse mode, cleared.
    expect(searchInput().value).toBe('');
  });

  it('still selects a true leaf from search, even when branch rows exist for its ancestors', () => {
    renderPicker();

    pickJacketsBySearch();

    expect(saveButton()).toBeEnabled();
  });

  it('says plainly when a search matches nothing, instead of an empty list', () => {
    renderPicker();

    openPicker();
    fireEvent.change(searchInput(), { target: { value: 'nonexistent' } });

    expect(
      screen.getByText('No category matches "nonexistent".'),
    ).toBeInTheDocument();
  });

  it('moves to a confirm step once a category is picked, enabled with no reason required, and back to browsing on Change', () => {
    renderPicker();

    pickJacketsBySearch();

    expect(saveButton()).toBeEnabled();
    expect(() => searchInput()).toThrow();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    expect(searchInput()).toBeInTheDocument();
  });

  it('saves with just the picked code, then closes the dialog and shows the new current path', async () => {
    const onSave = vi.fn(async () => ({
      ok: true as const,
      categoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
    }));

    renderPicker({ onSave });

    pickJacketsBySearch();
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('CAT-GGL-100230'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Change category' }),
    ).toBeInTheDocument();
  });

  it('shows the server refusal message and keeps the picked category on failure', async () => {
    const onSave = vi.fn(async () => ({
      ok: false as const,
      message: 'This CJ category was just remapped. Wait a moment.',
    }));

    renderPicker({ onSave });

    pickJacketsBySearch();
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This CJ category was just remapped. Wait a moment.',
      ),
    );
    // The pick and the open dialog survive the failure — nothing forces the
    // seller to start over.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    ).toBeInTheDocument();
  });

  it('disables Save and says "Saving…" while the request is in flight', async () => {
    let resolveSave: (value: {
      ok: true;
      categoryPath: string;
    }) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<{ ok: true; categoryPath: string }>((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderPicker({ onSave });

    pickJacketsBySearch();
    fireEvent.click(saveButton());

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    resolveSave({ ok: true, categoryPath: 'Jackets' });

    await waitFor(() =>
      expect(screen.queryByText('Saving…')).not.toBeInTheDocument(),
    );
  });

  describe('CJ-default guardrail', () => {
    it('flags the value red with a caution tooltip when it is still the CJ default, never confirmed by a seller', () => {
      renderPicker({
        currentPath: 'Luggage & Bags > Backpacks',
        declaredBySeller: false,
      });

      expect(
        screen.getByLabelText('Not yet confirmed as Sals3 taxonomy'),
      ).toBeInTheDocument();
    });

    it('shows no guardrail once a seller has confirmed the category', () => {
      renderPicker({
        currentPath: 'Luggage & Bags > Backpacks',
        declaredBySeller: true,
      });

      expect(
        screen.queryByLabelText('Not yet confirmed as Sals3 taxonomy'),
      ).toBeNull();
    });

    it('shows no guardrail when nothing is set at all — "Not set" already says enough', () => {
      renderPicker({ currentPath: null, declaredBySeller: false });

      expect(
        screen.queryByLabelText('Not yet confirmed as Sals3 taxonomy'),
      ).toBeNull();
    });

    it('clears the guardrail immediately after a successful save, without waiting on a parent refresh', async () => {
      const onSave = vi.fn(async () => ({
        ok: true as const,
        categoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
      }));

      renderPicker({
        currentPath: 'Luggage & Bags > Backpacks',
        declaredBySeller: false,
        onSave,
      });

      expect(
        screen.getByLabelText('Not yet confirmed as Sals3 taxonomy'),
      ).toBeInTheDocument();

      pickJacketsBySearch();
      fireEvent.click(saveButton());

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      // `declaredBySeller` prop passed to this render is still `false` — the
      // guardrail clearing here is the component's own optimistic state,
      // not a prop change.
      expect(
        screen.queryByLabelText('Not yet confirmed as Sals3 taxonomy'),
      ).toBeNull();
    });
  });
});
