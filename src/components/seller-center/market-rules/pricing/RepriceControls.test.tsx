import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  previewRepriceAction: vi.fn(),
  applyRepriceAction: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

vi.mock('@/app/(portal)/market-rules/pricing-actions', () => ({
  previewRepriceAction: mocks.previewRepriceAction,
  applyRepriceAction: mocks.applyRepriceAction,
}));

/* eslint-disable import/first */
import RepriceControls from './RepriceControls';

function previewLine(overrides: Record<string, unknown> = {}) {
  return {
    offerId: 'offer-1',
    productTitle: 'Corduroy jacket',
    sku: 'SALS3-1',
    marketCode: 'AU',
    status: 'CHANGED',
    currentPriceMinor: 2399,
    currentPriceCurrency: 'USD',
    newPriceMinor: 2999,
    newPriceCurrency: 'USD',
    reasonLabel: null,
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      counts: { changed: 1, unchanged: 4, unpriceable: 0, manual: 0 },
      truncated: false,
      candidateCount: 5,
      fingerprint: '1-abc',
      lines: [previewLine()],
      ...overrides,
    },
  };
}

const REASON = 'Supplier costs rose across the department.';

async function openAndCheck() {
  fireEvent.click(
    screen.getByRole('button', { name: /Reprice live products/ }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Check what would change/ }),
  );
  await screen.findByText(/1 price moves/);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.previewRepriceAction.mockResolvedValue(preview());
  mocks.applyRepriceAction.mockResolvedValue({
    ok: true,
    data: { written: 1, unchanged: 4, unpriceable: 0, manual: 0 },
  });
});

describe('RepriceControls', () => {
  /**
   * The guard the whole dialog exists for: a live price must never move
   * because somebody opened a dialog and typed a sentence.
   */
  it('cannot apply anything before the seller has looked', () => {
    render(<RepriceControls canManage />);

    fireEvent.click(
      screen.getByRole('button', { name: /Reprice live products/ }),
    );

    expect(
      screen.queryByRole('button', { name: 'Apply new prices' }),
    ).toBeDisabled();
    expect(screen.queryByLabelText('Reason for change')).toBeNull();
  });

  it('shows what each price is now and what it becomes', async () => {
    render(<RepriceControls canManage />);

    await openAndCheck();

    expect(screen.getByText('Corduroy jacket')).toBeInTheDocument();
    expect(screen.getByText('$23.99')).toBeInTheDocument();
    expect(screen.getByText('$29.99')).toBeInTheDocument();
  });

  it('checking writes nothing', async () => {
    render(<RepriceControls canManage />);

    await openAndCheck();

    expect(mocks.applyRepriceAction).not.toHaveBeenCalled();
  });

  it('still refuses to apply until a reason is written', async () => {
    render(<RepriceControls canManage />);

    await openAndCheck();

    expect(
      screen.getByRole('button', { name: 'Apply new prices' }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: 'short' },
    });

    expect(
      screen.getByRole('button', { name: 'Apply new prices' }),
    ).toBeDisabled();
  });

  it('sends the digest of the plan it showed, and the reason', async () => {
    render(<RepriceControls canManage />);

    await openAndCheck();
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: REASON },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply new prices' }));

    await waitFor(() =>
      expect(mocks.applyRepriceAction).toHaveBeenCalledWith({
        fingerprint: '1-abc',
        reason: REASON,
      }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  /**
   * A stale list is cleared, not left on screen looking approved — the
   * numbers it shows are no longer the numbers that would be written.
   */
  it('clears the list and says so when the prices moved underneath it', async () => {
    mocks.applyRepriceAction.mockResolvedValue({
      ok: false,
      reason: 'stale_preview',
    });
    render(<RepriceControls canManage />);

    await openAndCheck();
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: REASON },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply new prices' }));

    expect(
      await screen.findByText(/Prices moved while this list was open/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Corduroy jacket')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('names the products it could not price and says they keep their old price', async () => {
    mocks.previewRepriceAction.mockResolvedValue(
      preview({
        counts: { changed: 1, unchanged: 0, unpriceable: 1, manual: 0 },
        lines: [
          previewLine(),
          previewLine({
            offerId: 'offer-2',
            productTitle: 'Wool scarf',
            status: 'UNPRICEABLE',
            newPriceMinor: null,
            newPriceCurrency: null,
            reasonLabel: 'Supplier cost unavailable',
          }),
        ],
      }),
    );
    render(<RepriceControls canManage />);

    await openAndCheck();

    expect(screen.getByText('Wool scarf')).toBeInTheDocument();
    expect(screen.getByText('Supplier cost unavailable')).toBeInTheDocument();
    expect(screen.getByText(/1 that cannot be priced/)).toBeInTheDocument();
  });

  it('shows a hand-typed price as kept rather than as a change', async () => {
    mocks.previewRepriceAction.mockResolvedValue(
      preview({
        counts: { changed: 1, unchanged: 0, unpriceable: 0, manual: 1 },
        lines: [
          previewLine(),
          previewLine({
            offerId: 'offer-3',
            productTitle: 'Linen shirt',
            status: 'MANUAL',
            newPriceMinor: null,
            newPriceCurrency: null,
          }),
        ],
      }),
    );
    render(<RepriceControls canManage />);

    await openAndCheck();

    expect(screen.getByText('Kept — priced by hand')).toBeInTheDocument();
    expect(
      screen.getByText(/1 priced by hand and left alone/),
    ).toBeInTheDocument();
  });

  /** A silent cap reads as "everything is up to date" when it is not. */
  it('says when the run could not cover every product', async () => {
    mocks.previewRepriceAction.mockResolvedValue(preview({ truncated: true }));
    render(<RepriceControls canManage />);

    await openAndCheck();

    expect(
      screen.getByText(/more than 500 published products/),
    ).toBeInTheDocument();
  });

  it('lets a read-only caller look, but never apply', async () => {
    render(<RepriceControls canManage={false} />);

    fireEvent.click(
      screen.getByRole('button', { name: /Reprice live products/ }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Check what would change/ }),
    );
    await screen.findByText(/1 price moves/);

    expect(screen.queryByLabelText('Reason for change')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Apply new prices' }),
    ).toBeNull();
  });
});
