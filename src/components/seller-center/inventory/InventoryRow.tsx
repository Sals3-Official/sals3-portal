import { TableCell, TableRow } from '@/components/ui/table';
import {
  SELLABLE_LOW_THRESHOLD,
  type StockItem,
} from '@/lib/seller-center/mock-data/inventory';
import InventoryStepper from './InventoryStepper';

type InventoryRowProps = {
  item: StockItem;
  onHand: number;
  edited: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
};

export default function InventoryRow({
  item,
  onHand,
  edited,
  onDecrement,
  onIncrement,
}: InventoryRowProps) {
  const sellable = Math.max(0, onHand - item.reserved);
  const low = sellable <= SELLABLE_LOW_THRESHOLD;

  return (
    <TableRow className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 md:table-row md:px-0 md:py-0">
      <TableCell className="block w-full p-0 whitespace-normal md:table-cell md:w-auto md:p-2">
        <p className="font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          {item.sku} · {item.variant}
        </p>
      </TableCell>
      <TableCell className="hidden p-0 text-sm text-ink-muted md:table-cell md:p-2">
        {item.location}
      </TableCell>
      <TableCell className="block p-0 text-right text-sm text-muted-foreground md:table-cell md:p-2">
        {item.reserved}
      </TableCell>
      <TableCell
        className={`block p-0 text-right text-sm font-semibold tabular-nums md:table-cell md:p-2 ${
          low ? 'text-red-600' : 'text-foreground'
        }`}
      >
        {sellable}
      </TableCell>
      <TableCell className="block p-0 md:table-cell md:p-2">
        <InventoryStepper
          onHand={onHand}
          edited={edited}
          onDecrement={onDecrement}
          onIncrement={onIncrement}
        />
      </TableCell>
    </TableRow>
  );
}
