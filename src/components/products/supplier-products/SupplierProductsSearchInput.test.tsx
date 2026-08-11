import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { pushMock, searchParams } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchParams: new URLSearchParams('view=all&page=3'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

// eslint-disable-next-line import/first
import SupplierProductsSearchInput from './SupplierProductsSearchInput';

/**
 * The old table searched after a single typed character. These tests pin the
 * corrected behaviour: a two-character minimum, a 350 ms debounce, immediate
 * Enter once the minimum is met, page reset on a committed change, and a
 * clear that restores the unfiltered scoped set.
 */

function type(value: string) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value } });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  pushMock.mockClear();
});

describe('SupplierProductsSearchInput', () => {
  it('submits no search for a single meaningful character', () => {
    render(<SupplierProductsSearchInput value="" />);

    type('a');
    advance(2_000);

    expect(pushMock).not.toHaveBeenCalled();
    expect(
      screen.getByText('Type at least 2 characters to search'),
    ).toBeInTheDocument();
  });

  it('debounces a two-or-more-character search by 350 ms', () => {
    render(<SupplierProductsSearchInput value="" />);

    type('mu');
    advance(340);
    expect(pushMock).not.toHaveBeenCalled();

    advance(20);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).toContain('q=mu');
  });

  it('coalesces fast typing into one request for the final term', () => {
    render(<SupplierProductsSearchInput value="" />);

    type('mu');
    advance(100);
    type('mug');
    advance(100);
    type('mugs');
    advance(400);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).toContain('q=mugs');
  });

  it('submits immediately on Enter once the minimum is met', () => {
    render(<SupplierProductsSearchInput value="" />);

    type('mug');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });

    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter below the minimum, so it cannot bypass the rule', () => {
    render(<SupplierProductsSearchInput value="" />);

    type('m');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    advance(2_000);

    expect(pushMock).not.toHaveBeenCalled();
  });

  it('resets to page one when the committed search changes', () => {
    render(<SupplierProductsSearchInput value="" />);

    type('mug');
    advance(400);

    expect(pushMock.mock.calls[0][0]).not.toContain('page=3');
  });

  it('restores the unfiltered scoped set when the field is cleared', () => {
    render(<SupplierProductsSearchInput value="mug" />);

    type('');
    advance(400);

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).not.toContain('q=');
  });

  it('does not re-request a term the server already rendered', () => {
    render(<SupplierProductsSearchInput value="mug" />);

    advance(2_000);

    expect(pushMock).not.toHaveBeenCalled();
  });

  it('treats whitespace-only input as no search at all', () => {
    render(<SupplierProductsSearchInput value="" />);

    type('   ');
    advance(2_000);

    expect(pushMock).not.toHaveBeenCalled();
  });

  it('preserves what the user typed while a request is pending', () => {
    render(<SupplierProductsSearchInput value="" />);

    type('mug');
    advance(400);

    expect(screen.getByRole('searchbox')).toHaveValue('mug');
  });
});
