/**
 * Illustrative static data checked into this repository for interface
 * review only. No backend ledger or settlement system exists yet. Amounts,
 * dates, and rule versions are examples, not a real Sals3 order.
 */

import type { SellerCenterMarket } from '@/lib/seller-center/market-config';

export type LedgerLine = {
  label: string;
  amountMinor: number;
  ruleRef: string;
  emphasis?: boolean;
};

export function buildLedgerLines(market: SellerCenterMarket): LedgerLine[] {
  return [
    {
      label: 'Item revenue',
      amountMinor: 498000,
      ruleRef: 'catalogue price × 4',
      emphasis: true,
    },
    {
      label: 'Buyer-paid shipping',
      amountMinor: 18000,
      ruleRef: `zone A · ${market.carrierName}`,
      emphasis: true,
    },
    {
      label: 'Platform subsidy',
      amountMinor: 10000,
      ruleRef: 'campaign SUM26 · ends 31 Aug',
      emphasis: true,
    },
    {
      label: 'Commission fee',
      amountMinor: -44800,
      ruleRef: `packaging category 9% · ${market.ruleVersion}`,
    },
    {
      label: 'Transaction fee',
      amountMinor: -10200,
      ruleRef: `2% + fixed · ${market.ruleVersion}`,
    },
    {
      label: 'Seller-funded discount',
      amountMinor: -25000,
      ruleRef: 'your voucher SAVE5',
    },
    {
      label: market.taxLabel,
      amountMinor: -12400,
      ruleRef: 'effective 1 Jan 2026',
    },
  ];
}

export const DEFAULT_LEDGER_ORDER_ID = 'A-88214';
export const DEFAULT_SETTLEMENT_DATE = '12 Aug 2026';

export type VarianceReason = {
  id: string;
  label: string;
  sharePct: number;
};

export const VARIANCE_REASONS: VarianceReason[] = [
  {
    id: 'late-discount',
    label: 'Seller-funded discount posted late',
    sharePct: 41,
  },
  {
    id: 'partial-refund',
    label: 'Partial refund after estimate',
    sharePct: 28,
  },
  {
    id: 'weight-correction',
    label: 'Shipping weight correction',
    sharePct: 19,
  },
];

export const VARIANCE_MEDIAN_PCT = -1.8;
export const VARIANCE_SAMPLE_NOTE = 'median, last 90 days · 412 orders';
