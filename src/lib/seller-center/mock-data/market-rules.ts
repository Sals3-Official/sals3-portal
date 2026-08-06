/**
 * Illustrative static data checked into this repository for interface
 * review only. Rows here echo the rule citations already shown elsewhere
 * in Seller Center (Overview, Orders, Finances, Payouts) so this screen
 * stays a real cross-reference, not a rule list invented on its own.
 */

import type { SellerCenterMarket } from '@/lib/seller-center/market-config';

export type MarketRule = {
  id: string;
  name: string;
  scope: string;
  source: string;
  effectiveDate: string;
  version: string;
};

export function buildMarketRules(market: SellerCenterMarket): MarketRule[] {
  return [
    {
      id: 'commission-packaging',
      name: 'Commission — packaging',
      scope: 'Packaging › Mailers & envelopes',
      source: 'Fee schedule',
      effectiveDate: '2026-07-01',
      version: market.ruleVersion,
    },
    {
      id: 'transaction-fee',
      name: 'Transaction fee',
      scope: 'All categories',
      source: 'Fee schedule',
      effectiveDate: '2026-07-01',
      version: market.ruleVersion,
    },
    {
      id: 'tax',
      name: market.taxLabel,
      scope: 'Registered sellers',
      source: 'Regulator',
      effectiveDate: '2026-01-01',
      version: 'tax-2026.1',
    },
    {
      id: 'payout-threshold',
      name: 'Payout threshold',
      scope: market.payoutRail,
      source: 'Payout policy',
      effectiveDate: '2026-03-15',
      version: 'pay-2026.3',
    },
    {
      id: 'carrier-cutoff',
      name: 'Carrier cutoff',
      scope: market.carrierName,
      source: 'Logistics adapter',
      effectiveDate: '2026-06-01',
      version: 'log-2026.6',
    },
  ];
}

export type RoleExplainer = {
  id: string;
  name: string;
  text: string;
};

export const ROLE_EXPLAINERS: RoleExplainer[] = [
  {
    id: 'owner',
    name: 'Owner (seller manager)',
    text: 'Full access. Only the owner can see or change the payout destination, open Finances and Payouts, and change market-facing account settings.',
  },
  {
    id: 'staff',
    name: 'Staff (seller staff)',
    text: 'Lists products, packs and prints orders, edits stock, and can see Overview, Orders, Inventory, and this rules page. Cannot open Finances or Payouts. Every action is recorded against their own name.',
  },
];
