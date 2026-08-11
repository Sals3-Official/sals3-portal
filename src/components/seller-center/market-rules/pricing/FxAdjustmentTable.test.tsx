import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PricingFxAdjustmentPolicyRow } from '@/lib/db/schema';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/(portal)/market-rules/pricing-actions', () => ({
  saveFxAdjustmentPolicyAction: vi.fn(),
  deactivateFxAdjustmentPolicyAction: vi.fn(),
}));

/* eslint-disable import/first */
import FxAdjustmentTable from './FxAdjustmentTable';

const POLICY: PricingFxAdjustmentPolicyRow = {
  id: 'fx-policy-1',
  sellerAccountId: 'seller-1',
  sourceCurrency: 'USD',
  targetCurrency: 'AUD',
  fundingRail: 'CJ_WALLET_WIRE_TRANSFER',
  adjustmentRate: '0.025000',
  status: 'ACTIVE',
  version: 1,
  supersedesId: null,
  reason: 'Covers the wire transfer FX spread.',
  actorId: 'user-1',
  effectiveFrom: new Date('2026-08-01T00:00:00Z'),
  effectiveTo: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

describe('FxAdjustmentTable', () => {
  it('shows the currency pair, funding rail label, and signed adjustment', () => {
    render(
      <FxAdjustmentTable
        policies={[POLICY]}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(screen.getByText('USD → AUD')).toBeInTheDocument();
    expect(screen.getByText('CJ Wallet — wire transfer')).toBeInTheDocument();
    expect(screen.getByText('+2.50%')).toBeInTheDocument();
    expect(screen.getByText('No end date')).toBeInTheDocument();
  });

  it('shows a negative adjustment with its sign', () => {
    render(
      <FxAdjustmentTable
        policies={[{ ...POLICY, adjustmentRate: '-0.025000' }]}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(screen.getByText('-2.50%')).toBeInTheDocument();
  });

  it('hides Edit/Deactivate controls for a caller who cannot manage pricing', () => {
    render(
      <FxAdjustmentTable
        policies={[POLICY]}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });
});
