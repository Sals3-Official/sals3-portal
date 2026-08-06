import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import StatusPill, {
  type StatusPillTone,
} from '@/components/seller-center/shared/StatusPill';
import type { Order } from '@/lib/seller-center/mock-data/orders';

const SYNC_TONE: Record<Order['sync'], StatusPillTone> = {
  ready: 'info',
  synced: 'success',
  pending: 'warning',
  failed: 'danger',
};

const SYNC_LABEL: Record<Order['sync'], string> = {
  ready: 'Ready',
  synced: 'Synced',
  pending: 'Pending',
  failed: 'Sync failed',
};

type OrdersRowProps = {
  order: Order;
  selected: boolean;
  onToggle: (id: string) => void;
  amountLabel: string;
};

export default function OrdersRow({
  order,
  selected,
  onToggle,
  amountLabel,
}: OrdersRowProps) {
  return (
    <TableRow
      className={
        selected
          ? 'flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-accent px-3 py-3 md:table-row md:px-0 md:py-0'
          : 'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 md:table-row md:px-0 md:py-0'
      }
    >
      <TableCell className="block p-0 md:table-cell md:p-2">
        <Checkbox
          checked={selected}
          disabled={order.locked}
          onCheckedChange={() => onToggle(order.id)}
          aria-label={`Select order ${order.id}`}
        />
      </TableCell>
      <TableCell className="block w-full p-0 whitespace-normal md:table-cell md:w-auto md:p-2">
        <p className="font-medium">{order.id}</p>
        <p className="text-xs text-muted-foreground">{order.buyer}</p>
      </TableCell>
      <TableCell className="hidden p-0 text-sm text-ink-muted md:table-cell md:p-2">
        {order.items}
      </TableCell>
      <TableCell
        className={`block p-0 text-sm md:table-cell md:p-2 ${
          order.isCutoffToday ? 'font-semibold text-red-600' : 'text-ink-muted'
        }`}
      >
        {order.cutoffLabel}
      </TableCell>
      <TableCell className="block p-0 md:table-cell md:p-2">
        <StatusPill
          label={SYNC_LABEL[order.sync]}
          tone={SYNC_TONE[order.sync]}
        />
        {order.locked && order.lockedReason ? (
          <p className="mt-1 text-xs text-muted-foreground md:hidden">
            {order.lockedReason}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="block p-0 text-right font-medium tabular-nums md:table-cell md:p-2">
        {amountLabel}
      </TableCell>
    </TableRow>
  );
}
