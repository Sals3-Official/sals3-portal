/**
 * Illustrative static data checked into this repository for interface
 * review only. No backend payout system exists yet. Amounts, dates, and
 * trace IDs are examples, not real Sals3 payouts.
 */

import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import { formatMarketMoney } from '@/lib/seller-center/money';

export type ScheduleKey = 'daily' | 'weekly' | 'monthly' | 'manual';

export type ScheduleOption = {
  key: ScheduleKey;
  label: string;
  note: string;
  disabled: boolean;
};

export function buildScheduleOptions(
  market: SellerCenterMarket,
): ScheduleOption[] {
  return [
    {
      key: 'daily',
      label: 'Daily',
      note: market.dailyPayoutSupported
        ? `Business days, above ${formatMarketMoney(market.payoutThresholdMinor, market)}.`
        : market.dailyPayoutNote,
      disabled: !market.dailyPayoutSupported,
    },
    { key: 'weekly', label: 'Weekly', note: 'Every Tuesday.', disabled: false },
    {
      key: 'monthly',
      label: 'Monthly',
      note: 'Last business day of the month.',
      disabled: false,
    },
    {
      key: 'manual',
      label: 'Manual',
      note: 'You request each payout yourself.',
      disabled: false,
    },
  ];
}

export const DEFAULT_SCHEDULE: ScheduleKey = 'weekly';

export type PayoutState = {
  id: string;
  state: string;
  tone: StatusPillTone;
  amountMinor: number;
  note: string;
  traceId: string;
};

export const PAYOUT_STATES: PayoutState[] = [
  {
    id: 'p1',
    state: 'Deposited',
    tone: 'success',
    amountMinor: 2431000,
    note: 'Confirmed by your bank or wallet.',
    traceId: 'TRX-9F21A',
  },
  {
    id: 'p2',
    state: 'Sent',
    tone: 'info',
    amountMinor: 1879000,
    note: 'Left Seller Center, not yet confirmed.',
    traceId: 'TRX-9F44C',
  },
  {
    id: 'p3',
    state: 'Processing',
    tone: 'info',
    amountMinor: 2140000,
    note: 'Your bank is processing this, usually 1 business day.',
    traceId: 'TRX-9F52B',
  },
  {
    id: 'p4',
    state: 'Held',
    tone: 'warning',
    amountMinor: 612000,
    note: 'The refund window is still open on 3 orders.',
    traceId: 'HLD-2210',
  },
  {
    id: 'p5',
    state: 'Failed',
    tone: 'danger',
    amountMinor: 348000,
    note: 'The account name did not match. You can retry.',
    traceId: 'TRX-9E88D',
  },
];
