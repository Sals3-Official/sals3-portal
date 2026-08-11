/**
 * Role explanations for the Market Rules screen.
 *
 * These describe the real permission model in `src/lib/auth/permissions.ts`
 * in plain language — they are not illustrative data. The commission, tax,
 * payout-threshold, and carrier-cutoff rows that used to live here were
 * derived from the PH/ID/SG fixture in `market-config.ts` and presented
 * invented fee and logistics figures as this account's rules; they were
 * removed when Market Rules moved onto the real per-seller market profile
 * (`modules/market-config/`). Restoring them would mean re-inventing a fee
 * schedule, a tax treatment, and a carrier contract that do not exist.
 */

export type RoleExplainer = {
  id: string;
  name: string;
  text: string;
};

export const ROLE_EXPLAINERS: RoleExplainer[] = [
  {
    id: 'owner',
    name: 'Owner (seller manager)',
    text: 'Full access. Only the owner can see or change the payout destination, open Finances and Payouts, set up or suspend a market destination, and change market-facing account settings.',
  },
  {
    id: 'staff',
    name: 'Staff (seller staff)',
    text: 'Lists products, packs and prints orders, edits stock, and can see Overview, Orders, Inventory, and this rules page. Cannot open Finances or Payouts, and cannot change market setup. Every action is recorded against their own name.',
  },
];
