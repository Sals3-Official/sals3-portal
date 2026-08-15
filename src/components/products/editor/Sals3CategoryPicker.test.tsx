import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Sals3CategoryPicker from './Sals3CategoryPicker';

const OPTIONS = [
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
    onSave: (
      code: string,
      reason: string,
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
      onSave={onSave}
    />,
  );

  return { onSave };
}

function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText(
    /Search the Sals3 v1 taxonomy/i,
  ) as HTMLInputElement;
}

function reasonInput(): HTMLInputElement {
  return screen.getByLabelText('Reason') as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /^Save category$/,
  }) as HTMLButtonElement;
}

describe('Sals3CategoryPicker', () => {
  it('shows "Not yet decided" when nothing has ever been resolved for this product', () => {
    renderPicker({ currentPath: null });

    expect(screen.getByText(/Current: Not yet decided/)).toBeInTheDocument();
  });

  it('shows the currently resolved category when one exists', () => {
    renderPicker({ currentPath: 'Luggage & Bags > Backpacks' });

    expect(
      screen.getByText(/Current: Luggage & Bags > Backpacks/),
    ).toBeInTheDocument();
  });

  it('shows no matches until a query is typed', () => {
    renderPicker();

    expect(screen.queryByRole('button', { name: /Jackets/ })).toBeNull();
  });

  it('filters the tree by substring match, case-insensitively, across depth', () => {
    renderPicker();

    fireEvent.change(searchInput(), { target: { value: 'jackets' } });

    expect(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Luggage & Bags > Backpacks')).toBeNull();
    expect(screen.queryByText('Health & Beauty > Personal Care')).toBeNull();
  });

  it('says plainly when a search matches nothing, instead of an empty list', () => {
    renderPicker();

    fireEvent.change(searchInput(), { target: { value: 'nonexistent' } });

    expect(
      screen.getByText('No category matches "nonexistent".'),
    ).toBeInTheDocument();
  });

  it('moves to the reason step once a category is picked, and back on Change', () => {
    renderPicker();

    fireEvent.change(searchInput(), { target: { value: 'jackets' } });
    fireEvent.click(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    );

    expect(reasonInput()).toBeInTheDocument();
    expect(searchInput).toThrow();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    expect(searchInput()).toBeInTheDocument();
  });

  it('keeps Save disabled until a reason of at least 8 characters is entered, and says how many more are needed', () => {
    renderPicker();

    fireEvent.change(searchInput(), { target: { value: 'jackets' } });
    fireEvent.click(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    );

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText('8 more characters needed.')).toBeInTheDocument();

    fireEvent.change(reasonInput(), { target: { value: 'short' } });
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText('3 more characters needed.')).toBeInTheDocument();

    fireEvent.change(reasonInput(), { target: { value: 'seven ch' } });
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(/more characters? needed/)).toBeNull();
  });

  it('trims the reason before deciding it clears the minimum length', () => {
    renderPicker();

    fireEvent.change(searchInput(), { target: { value: 'jackets' } });
    fireEvent.click(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    );
    fireEvent.change(reasonInput(), { target: { value: '   short   ' } });

    expect(saveButton()).toBeDisabled();
  });

  it('saves with the picked code and trimmed reason, then resets to search with the new current path', async () => {
    const onSave = vi.fn(async () => ({
      ok: true as const,
      categoryPath: 'Apparel & Accessories > Clothing > Outerwear > Jackets',
    }));

    renderPicker({ onSave });

    fireEvent.change(searchInput(), { target: { value: 'jackets' } });
    fireEvent.click(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    );
    fireEvent.change(reasonInput(), {
      target: { value: '  A real jacket, not an accessory.  ' },
    });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'CAT-GGL-100230',
        'A real jacket, not an accessory.',
      ),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          /Current: Apparel & Accessories > Clothing > Outerwear > Jackets/,
        ),
      ).toBeInTheDocument(),
    );
    expect(searchInput()).toHaveValue('');
  });

  it('shows the server refusal message and keeps the picked category on failure', async () => {
    const onSave = vi.fn(async () => ({
      ok: false as const,
      message: 'This CJ category was just remapped. Wait a moment.',
    }));

    renderPicker({ onSave });

    fireEvent.change(searchInput(), { target: { value: 'jackets' } });
    fireEvent.click(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    );
    fireEvent.change(reasonInput(), {
      target: { value: 'A real jacket, not an accessory.' },
    });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This CJ category was just remapped. Wait a moment.',
      ),
    );
    // The pick survives the failure — nothing forces the seller to search again.
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

    fireEvent.change(searchInput(), { target: { value: 'jackets' } });
    fireEvent.click(
      screen.getByText(
        'Apparel & Accessories > Clothing > Outerwear > Jackets',
      ),
    );
    fireEvent.change(reasonInput(), {
      target: { value: 'A real jacket, not an accessory.' },
    });
    fireEvent.click(saveButton());

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    resolveSave({ ok: true, categoryPath: 'Jackets' });

    await waitFor(() =>
      expect(screen.queryByText('Saving…')).not.toBeInTheDocument(),
    );
  });
});
