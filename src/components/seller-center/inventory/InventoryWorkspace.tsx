'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  INITIAL_AUDIT_TRAIL,
  STOCK_ITEMS,
  type AuditEntry,
  type StockItem,
} from '@/lib/seller-center/mock-data/inventory';
import InventoryAuditTrailPanel from './InventoryAuditTrailPanel';
import InventoryRow from './InventoryRow';
import InventorySafetyRulesPanel from './InventorySafetyRulesPanel';

function formatNow(): string {
  return new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Owns the live on-hand quantities and the audit trail so every stepper
 * click updates both together, with an undo toast that also records the
 * reversal - the audit trail never loses an entry, it only ever grows.
 */
export default function InventoryWorkspace() {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [audit, setAudit] = useState<AuditEntry[]>(INITIAL_AUDIT_TRAIL);

  const getOnHand = (item: StockItem) => qty[item.sku] ?? item.onHand;

  const applyChange = (item: StockItem, next: number, source: string) => {
    if (next < 0) {
      return;
    }

    const current = getOnHand(item);
    const stamp = formatNow();

    setQty((prevQty) => ({ ...prevQty, [item.sku]: next }));
    setAudit((prevAudit) => [
      {
        id: `audit-${item.sku}-${prevAudit.length}-${next}`,
        text: `You changed the amount on hand for ${item.name}: ${current} → ${next}`,
        meta: `${source} · ${stamp}`,
      },
      ...prevAudit,
    ]);

    toast(`${item.name} updated: ${current} → ${next}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          const revertStamp = formatNow();

          setQty((prevQty) => ({ ...prevQty, [item.sku]: current }));
          setAudit((prevAudit) => [
            {
              id: `audit-${item.sku}-undo-${prevAudit.length}`,
              text: `You undid the change to ${item.name}: ${next} → ${current}`,
              meta: `undo · ${revertStamp}`,
            },
            ...prevAudit,
          ]);
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU / variant</TableHead>
              <TableHead className="hidden md:table-cell">Location</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Sellable</TableHead>
              <TableHead className="text-right">On hand</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {STOCK_ITEMS.map((item) => {
              const onHand = getOnHand(item);

              return (
                <InventoryRow
                  key={item.sku}
                  item={item}
                  onHand={onHand}
                  edited={qty[item.sku] !== undefined}
                  onDecrement={() => applyChange(item, onHand - 1, 'manual')}
                  onIncrement={() => applyChange(item, onHand + 1, 'manual')}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InventoryAuditTrailPanel entries={audit} />
        <InventorySafetyRulesPanel />
      </div>
    </div>
  );
}
