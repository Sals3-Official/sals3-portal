/**
 * Illustrative static data checked into this repository for interface
 * review only. No backend order system exists yet. Names, amounts, and
 * timestamps are examples, not real Sals3 orders.
 */

import type { OrdersQuery } from '@/lib/seller-center/orders-query';

export type OrderSyncState = 'ready' | 'synced' | 'pending' | 'failed';

export type Order = {
  id: string;
  buyer: string;
  items: string;
  cutoffLabel: string;
  isCutoffToday: boolean;
  sync: OrderSyncState;
  amountMinor: number;
  locked?: boolean;
  lockedReason?: string;
};

export const ORDERS: Order[] = [
  {
    id: 'A-88214',
    buyer: 'R. Domingo · Quezon City',
    items: '2× Kraft mailer 32cm, 1× Thermal roll',
    cutoffLabel: 'today',
    isCutoffToday: true,
    sync: 'ready',
    amountMinor: 128400,
  },
  {
    id: 'A-88215',
    buyer: 'L. Tan · Cebu',
    items: '1× Packing tape 6-pack',
    cutoffLabel: 'today',
    isCutoffToday: true,
    sync: 'ready',
    amountMinor: 64200,
  },
  {
    id: 'A-88216',
    buyer: 'J. Aquino · Davao',
    items: '4× Bubble wrap 500mm',
    cutoffLabel: 'today',
    isCutoffToday: true,
    sync: 'failed',
    amountMinor: 218000,
    locked: true,
    lockedReason: 'The label did not sync to the carrier.',
  },
  {
    id: 'A-88217',
    buyer: 'M. Cruz · Makati',
    items: '1× Label printer ribbon, 2× Kraft mailer 22cm',
    cutoffLabel: 'today',
    isCutoffToday: true,
    sync: 'ready',
    amountMinor: 345500,
  },
  {
    id: 'A-88218',
    buyer: 'S. Villanueva · Iloilo',
    items: '3× Poly mailer 25cm',
    cutoffLabel: 'tomorrow',
    isCutoffToday: false,
    sync: 'synced',
    amountMinor: 89000,
  },
  {
    id: 'A-88219',
    buyer: 'K. Reyes · Pasig',
    items: '1× Stretch film 500mm',
    cutoffLabel: 'today',
    isCutoffToday: true,
    sync: 'pending',
    amountMinor: 112000,
    locked: true,
    lockedReason: "The buyer's address is not confirmed yet.",
  },
];

export const ORDERS_EXCLUDED_NOTE =
  'A-88216 failed the carrier label sync and A-88219 is waiting on address confirmation. Both stay in this list, and your other selections are kept, while they get resolved.';

export type OrderFilterKey = OrdersQuery['orderFilter'];

export const ORDER_FILTERS: { key: OrderFilterKey; label: string }[] = [
  { key: 'ready', label: 'Ready to pack' },
  { key: 'cutoff', label: 'Cutoff today' },
  { key: 'failed', label: 'Sync failed' },
  { key: 'all', label: 'All open' },
];

export function filterOrders(orders: Order[], filter: OrderFilterKey): Order[] {
  switch (filter) {
    case 'ready':
      return orders.filter((order) => order.sync === 'ready');
    case 'cutoff':
      return orders.filter((order) => order.isCutoffToday);
    case 'failed':
      return orders.filter((order) => order.sync === 'failed');
    case 'all':
    default:
      return orders;
  }
}

export type ReprintHistoryEntry = {
  id: string;
  orderId: string;
  text: string;
  meta: string;
  tone: 'warning' | 'success';
};

export const REPRINT_HISTORY: ReprintHistoryEntry[] = [
  {
    id: 'rh-1',
    orderId: 'A-88203',
    text: 'reprinted — printer jam',
    meta: 'M. Reyes · 13:41 · reprint 1 of 1 · same tracking number',
    tone: 'warning',
  },
  {
    id: 'rh-2',
    orderId: 'A-88198',
    text: 'printed',
    meta: 'M. Reyes · 12:07 · first print',
    tone: 'success',
  },
  {
    id: 'rh-3',
    orderId: 'A-88191',
    text: 'printed',
    meta: 'A. Santos (staff) · 11:22 · first print',
    tone: 'success',
  },
];
