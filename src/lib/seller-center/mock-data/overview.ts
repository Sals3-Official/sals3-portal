/**
 * Illustrative static data checked into this repository for interface
 * review only. No backend order/inventory/finance system exists yet.
 * Names, numbers, dates, and rule versions are examples, not real Sals3
 * figures.
 */

import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';

export type OverviewTask = {
  id: string;
  tag: string;
  tone: StatusPillTone;
  count: string;
  deadline: string;
  text: string;
  ctaLabel: string;
  href: string;
};

export const OVERVIEW_TASKS: OverviewTask[] = [
  {
    id: 'pack-before-cutoff',
    tag: 'Required',
    tone: 'info',
    count: '12 orders',
    deadline: 'by cutoff today',
    text: 'Pack and label these before the carrier cutoff.',
    ctaLabel: 'Open batch',
    href: '/orders',
  },
  {
    id: 'label-sync-failed',
    tag: 'Exception',
    tone: 'danger',
    count: '3 orders',
    deadline: 'blocking',
    text: 'The label did not sync to the carrier. No shipment was created, so reprinting is safe.',
    ctaLabel: 'Resolve',
    href: '/orders',
  },
  {
    id: 'oversell-risk',
    tag: 'Required',
    tone: 'warning',
    count: '2 SKUs',
    deadline: 'oversell risk',
    text: 'Sellable quantity is below reserved. Adjust stock or pause the listing.',
    ctaLabel: 'Fix stock',
    href: '/inventory',
  },
];

export const OVERVIEW_ALL_TASK_COUNT = 9;

export type OverviewMoneyState = {
  id: 'estimated' | 'pending' | 'final';
  label: string;
  tone: StatusPillTone;
  amountMinor: number;
  note: string;
};

export const OVERVIEW_MONEY_STATES: OverviewMoneyState[] = [
  {
    id: 'estimated',
    label: 'Estimated',
    tone: 'info',
    amountMinor: 482500000,
    note: 'Orders not yet settled. Uses rules known today and can still change.',
  },
  {
    id: 'pending',
    label: 'Pending',
    tone: 'warning',
    amountMinor: 214000000,
    note: 'Settled but held: refund window open, plus a reserve.',
  },
  {
    id: 'final',
    label: 'Final',
    tone: 'success',
    amountMinor: 968300000,
    note: 'Posted to the ledger with settlement IDs and downloadable records.',
  },
];

export const OVERVIEW_VARIANCE_NOTE =
  'Estimate-to-final variance last cycle: −1.8%. Top reason: a seller-funded discount posted late.';

export type OverviewGlanceStat = {
  id: string;
  label: string;
  value: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
};

export const OVERVIEW_GLANCE_STATS: OverviewGlanceStat[] = [
  {
    id: 'orders-processed',
    label: 'Orders processed today',
    value: '38',
    tone: 'neutral',
  },
  {
    id: 'missed-cutoffs',
    label: 'Missed cutoffs this week',
    value: '0',
    tone: 'success',
  },
  {
    id: 'duplicate-shipments',
    label: 'Duplicate shipments this week',
    value: '0',
    tone: 'success',
  },
  {
    id: 'sync-failures',
    label: 'Unresolved sync failures',
    value: '3',
    tone: 'danger',
  },
  {
    id: 'missing-attribute',
    label: 'Listings missing a required attribute',
    value: '5',
    tone: 'warning',
  },
];

export type OverviewGrowthSuggestion = {
  id: string;
  title: string;
  body: string;
};

export const OVERVIEW_GROWTH_SUGGESTIONS: OverviewGrowthSuggestion[] = [
  {
    id: 'restock-soon',
    title: 'Two SKUs may sell out within a week',
    body: 'Bubble wrap 500mm and Thermal roll 80×58 are clearing stock faster than your usual reorder time.',
  },
  {
    id: 'add-photos',
    title: 'Add a second photo to 4 listings',
    body: 'Listings with two or more photos tend to get more views in your market.',
  },
];
