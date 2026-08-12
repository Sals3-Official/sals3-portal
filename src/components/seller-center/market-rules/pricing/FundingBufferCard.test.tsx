import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveFundingBufferPolicyAction: vi.fn(),
  getFundingBufferHistoryAction: vi
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
  saveFundingBufferPolicyAction: mocks.saveFundingBufferPolicyAction,
  getFundingBufferHistoryAction: mocks.getFundingBufferHistoryAction,
}));

/* eslint-disable import/first */
import type { PricingFxAdjustmentPolicyRow } from '@/lib/db/schema';
import FundingBufferCard from './FundingBufferCard';

const ACTIVE_POLICY: PricingFxAdjustmentPolicyRow = {
  id: 'buffer-1',
  sellerAccountId: 'seller-1',
  adjustmentRate: '0.030000',
  status: 'ACTIVE',
  version: 4,
  supersedesId: 'buffer-0',
  reason: 'AUD/USD moved against us on the last two CJ Wallet top-ups.',
  actorId: 'user-1',
  effectiveFrom: new Date('2026-08-09T00:00:00Z'),
  effectiveTo: null,
  createdAt: new Date('2026-07-02T00:00:00Z'),
  updatedAt: new Date('2026-08-09T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FundingBufferCard — no buffer set (first run)', () => {
  it('shows the blocking-not-optional warning and an always-visible input strip for a manager', () => {
    render(
      <FundingBufferCard policy={null} sellerAccountId="seller-1" canManage />,
    );

    expect(screen.getByText(/No funding buffer set\./)).toBeInTheDocument();
    expect(
      screen.getByText(/Category-margin pricing is unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Set a buffer' }),
    ).toBeInTheDocument();
  });

  it('hides the input strip for a signer without manage permission', () => {
    render(
      <FundingBufferCard
        policy={null}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(screen.getByText(/No funding buffer set\./)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Set a buffer' }),
    ).not.toBeInTheDocument();
  });

  it('still shows the history button even with no active buffer, so a previously deactivated buffer stays visible', () => {
    render(
      <FundingBufferCard policy={null} sellerAccountId="seller-1" canManage />,
    );

    expect(
      screen.getByRole('button', { name: 'Funding buffer history' }),
    ).toBeInTheDocument();
  });

  it('commits immediately on first save — nothing to overwrite', async () => {
    mocks.saveFundingBufferPolicyAction.mockResolvedValue({ ok: true });

    render(
      <FundingBufferCard policy={null} sellerAccountId="seller-1" canManage />,
    );

    fireEvent.change(screen.getByLabelText('Funding buffer percentage'), {
      target: { value: '3' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Reason (min 10 characters)'),
      {
        target: { value: 'First buffer, sized from a real top-up statement.' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set a buffer' }));

    await waitFor(() => {
      expect(mocks.saveFundingBufferPolicyAction).toHaveBeenCalledWith({
        adjustmentRate: '0.03',
        reason: 'First buffer, sized from a real top-up statement.',
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Funding buffer set.');
    expect(mocks.refresh).toHaveBeenCalled();
  });
});

describe('FundingBufferCard — active buffer', () => {
  it('renders the signed percent, Active pill, version, and reason', () => {
    render(
      <FundingBufferCard
        policy={ACTIVE_POLICY}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(screen.getByText('+3.00%')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('v4')).toBeInTheDocument();
    expect(
      screen.getByText(
        'AUD/USD moved against us on the last two CJ Wallet top-ups.',
      ),
    ).toBeInTheDocument();
  });

  it('hides Edit/Deactivate for a signer without manage permission', () => {
    render(
      <FundingBufferCard
        policy={ACTIVE_POLICY}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Deactivate' }),
    ).not.toBeInTheDocument();
  });

  it('toggling Edit reveals the inline strip and submits a revision, no dialog', async () => {
    mocks.saveFundingBufferPolicyAction.mockResolvedValue({ ok: true });

    render(
      <FundingBufferCard
        policy={ACTIVE_POLICY}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Funding buffer percentage'), {
      target: { value: '-2.5' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Reason (min 10 characters)'),
      {
        target: { value: 'Rate settled back after the swing.' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.saveFundingBufferPolicyAction).toHaveBeenCalledWith({
        adjustmentRate: '-0.025',
        reason: 'Rate settled back after the swing.',
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Funding buffer updated.');
  });
});
