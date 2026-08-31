import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CatalogueProductPagination from './CatalogueProductPagination';

describe('CatalogueProductPagination', () => {
  it('shows the current position and the total count', () => {
    render(
      <CatalogueProductPagination
        page={2}
        totalPages={4}
        total={83}
        pageSize={25}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByText('2 / 4')).toBeInTheDocument();
    expect(screen.getByText('83 products')).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last', () => {
    render(
      <CatalogueProductPagination
        page={1}
        totalPages={1}
        total={5}
        pageSize={25}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Previous page' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('reports the page a seller moves to', () => {
    const onPageChange = vi.fn();

    render(
      <CatalogueProductPagination
        page={2}
        totalPages={4}
        total={83}
        pageSize={25}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('shows the current page size and reports a change', async () => {
    const onPageSizeChange = vi.fn();

    render(
      <CatalogueProductPagination
        page={1}
        totalPages={1}
        total={10}
        pageSize={25}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    expect(screen.getByText('25 / page')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'Rows per page' }));

    const option = await screen.findByRole('option', { name: '12 / page' });

    // Base UI's option only commits a selection on `click` when a real
    // `pointerdown` preceded it on the same element (jsdom's `fireEvent.click`
    // does not synthesize one on its own, unlike a real browser click).
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(onPageSizeChange).toHaveBeenCalledWith(12);
  });
});
