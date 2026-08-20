import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveStoreDefaultAction: vi.fn(),
  deactivateStoreDefaultAction: vi.fn(),
  getStoreDefaultHistoryAction: vi
    .fn()
    .mockResolvedValue({ ok: true, data: [] }),
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
  saveStoreDefaultAction: mocks.saveStoreDefaultAction,
  deactivateStoreDefaultAction: mocks.deactivateStoreDefaultAction,
  getStoreDefaultHistoryAction: mocks.getStoreDefaultHistoryAction,
}));

/* eslint-disable import/first */
import type { PricingStoreDefaultRow } from '@/lib/db/schema';
import StoreDefaultCard from './StoreDefaultCard';

const ACTIVE_DEFAULT: PricingStoreDefaultRow = {
  id: 'store-default-1',
  sellerAccountId: 'seller-1',
  targetMarginRate: '0.350000',
  minContributionMinor: BigInt(250),
  minContributionCurrency: 'USD',
  roundingRule: 'NEAREST_0_99',
  status: 'ACTIVE',
  version: 2,
  supersedesId: 'store-default-0',
  reason: 'Raised after the first freight bills landed.',
  actorId: 'user-1',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-19T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StoreDefaultCard — first run (no default yet)', () => {
  it('states the consequence plainly and keeps the form visible for a manager', () => {
    render(
      <StoreDefaultCard policy={null} sellerAccountId="seller-1" canManage />,
    );

    expect(
      screen.getByText(/still needs a price typed by hand/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Set the default' }),
    ).toBeInTheDocument();
  });

  it('shows no form to a read-only caller', () => {
    render(
      <StoreDefaultCard
        policy={null}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Set the default' }),
    ).toBeNull();
  });

  it('submits margin as a rate, floor as entered, and the chosen rounding', async () => {
    mocks.saveStoreDefaultAction.mockResolvedValue({ ok: true });

    render(
      <StoreDefaultCard policy={null} sellerAccountId="seller-1" canManage />,
    );

    fireEvent.change(screen.getByLabelText('Default margin percent'), {
      target: { value: '35' },
    });
    fireEvent.change(
      screen.getByLabelText('Minimum profit per item in US dollars'),
      { target: { value: '2.50' } },
    );
    fireEvent.change(screen.getByPlaceholderText(/Why did you change this/), {
      target: { value: 'Initial default while the roster is small.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set the default' }));

    await waitFor(() =>
      expect(mocks.saveStoreDefaultAction).toHaveBeenCalledWith({
        targetMarginRate: '0.35',
        minContribution: '2.50',
        roundingRule: 'NONE',
        reason: 'Initial default while the roster is small.',
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('an empty floor field is sent as an explicit zero, never dropped', async () => {
    mocks.saveStoreDefaultAction.mockResolvedValue({ ok: true });

    render(
      <StoreDefaultCard policy={null} sellerAccountId="seller-1" canManage />,
    );

    fireEvent.change(screen.getByLabelText('Default margin percent'), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Why did you change this/), {
      target: { value: 'Margin only, no floor for now.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set the default' }));

    await waitFor(() =>
      expect(mocks.saveStoreDefaultAction).toHaveBeenCalledWith(
        expect.objectContaining({ minContribution: '0' }),
      ),
    );
  });

  it('shows the failure against the field that caused it, not a vague banner', async () => {
    mocks.saveStoreDefaultAction.mockResolvedValue({
      ok: false,
      reason: 'invalid_input',
      fieldErrors: { targetMarginRate: 'Enter a margin between 0 and 1.' },
    });

    render(
      <StoreDefaultCard policy={null} sellerAccountId="seller-1" canManage />,
    );

    fireEvent.change(screen.getByLabelText('Default margin percent'), {
      target: { value: '35' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Why did you change this/), {
      target: { value: 'A perfectly valid reason.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set the default' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Enter a margin between 0 and 1/,
    );
    // The input itself is marked, so the message is not an orphan claim.
    expect(screen.getByLabelText('Default margin percent')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('refuses to submit a reason the server is certain to reject', () => {
    render(
      <StoreDefaultCard policy={null} sellerAccountId="seller-1" canManage />,
    );

    fireEvent.change(screen.getByLabelText('Default margin percent'), {
      target: { value: '35' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Why did you change this/), {
      target: { value: 'short' },
    });

    // The old form let this through and reported "check the highlighted
    // fields" after a round trip, with nothing highlighted.
    expect(
      screen.getByRole('button', { name: 'Set the default' }),
    ).toBeDisabled();
    // And it says how far off the reason is, before the attempt.
    expect(
      screen.getByText(/Use 10 characters or more\. You have 5\./),
    ).toBeInTheDocument();
  });
});

describe('StoreDefaultCard — active default', () => {
  it('shows the rate, the floor as money, version, and the recorded reason', () => {
    render(
      <StoreDefaultCard
        policy={ACTIVE_DEFAULT}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(screen.getByText('35.00%')).toBeInTheDocument();
    expect(screen.getByText('US$2.50')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(
      screen.getByText('Raised after the first freight bills landed.'),
    ).toBeInTheDocument();
  });

  it('a zero floor reads "no floor" rather than US$0.00', () => {
    render(
      <StoreDefaultCard
        policy={{ ...ACTIVE_DEFAULT, minContributionMinor: BigInt(0) }}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(screen.getByText('no floor')).toBeInTheDocument();
    expect(screen.queryByText('US$0.00')).toBeNull();
  });

  it('the form stays hidden until Edit is pressed', () => {
    render(
      <StoreDefaultCard
        policy={ACTIVE_DEFAULT}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(screen.queryByLabelText('Default margin percent')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Default margin percent')).toBeInTheDocument();
  });

  it('always states the scope honestly — freight quoted at checkout, inputs still provisional', () => {
    render(
      <StoreDefaultCard
        policy={ACTIVE_DEFAULT}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(
      screen.getByText(/shipping is quoted separately at checkout/),
    ).toBeInTheDocument();
  });
});
