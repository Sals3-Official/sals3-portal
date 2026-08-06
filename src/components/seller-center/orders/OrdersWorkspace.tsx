'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMarketMoney } from '@/lib/seller-center/money';
import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import type { Order } from '@/lib/seller-center/mock-data/orders';
import OrdersBulkActionBar from './OrdersBulkActionBar';
import OrdersRow from './OrdersRow';

type OrdersWorkspaceProps = {
  orders: Order[];
  market: SellerCenterMarket;
};

/**
 * Owns row selection so the sticky bulk-action bar and the checkbox column
 * stay in sync. Locked rows (failed sync, unconfirmed address) can never be
 * selected - excluding them from a batch is a safety rule, not a UI quirk.
 */
export default function OrdersWorkspace({
  orders,
  market,
}: OrdersWorkspaceProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectableOrders = orders.filter((order) => !order.locked);
  const allSelected =
    selectableOrders.length > 0 &&
    selectableOrders.every((order) => selected.has(order.id));
  const selectedOrders = orders.filter((order) => selected.has(order.id));
  const proceedsMinor = selectedOrders.reduce(
    (sum, order) => sum + order.amountMinor,
    0,
  );

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const toggleAll = () => {
    setSelected(
      allSelected
        ? new Set()
        : new Set(selectableOrders.map((order) => order.id)),
    );
  };

  const handlePrint = () => {
    const count = selected.size;
    const previousSelection = new Set(selected);

    setSelected(new Set());

    toast(
      `${count} label${count === 1 ? '' : 's'} queued. Nothing is sent to ${
        market.carrierName
      } until print confirms.`,
      {
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => setSelected(previousSelection),
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all selectable orders"
                />
              </TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="hidden md:table-cell">Items</TableHead>
              <TableHead className="hidden md:table-cell">Cutoff</TableHead>
              <TableHead>Sync</TableHead>
              <TableHead className="text-right">Est. proceeds</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <OrdersRow
                key={order.id}
                order={order}
                selected={selected.has(order.id)}
                onToggle={toggleOne}
                amountLabel={formatMarketMoney(order.amountMinor, market)}
              />
            ))}
            {orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No orders match this filter.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {selected.size > 0 ? (
        <OrdersBulkActionBar
          selectedCount={selected.size}
          proceedsLabel={formatMarketMoney(proceedsMinor, market)}
          carrierName={market.carrierName}
          onClear={() => setSelected(new Set())}
          onPrint={handlePrint}
        />
      ) : null}
    </div>
  );
}
