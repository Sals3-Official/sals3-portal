import type { ReactNode } from 'react';

type OrdersResultBarProps = {
  /** Caller decides the unit - "6 parcels" here, "2 orders" elsewhere. */
  countLabel: string;
  contextLabel: string | null;
  sortLabel: string;
  bulkSlot?: ReactNode;
};

/**
 * The count line above the list.
 *
 * Two counts, not one. The rows are parcels, but the reference a buyer would
 * quote is the order - so "6 parcels · under 5 order references" answers both
 * questions instead of forcing the seller to reconcile a number that does not
 * match the one in their inbox.
 */
export default function OrdersResultBar({
  countLabel,
  contextLabel,
  sortLabel,
  bulkSlot,
}: OrdersResultBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">
        {countLabel}
        {contextLabel === null ? null : (
          <span className="ml-1 font-normal text-ink-muted">
            {contextLabel}
          </span>
        )}
      </p>
      <div className="flex items-center gap-3">
        <p className="text-xs text-ink-muted">Sort: {sortLabel}</p>
        {bulkSlot}
      </div>
    </div>
  );
}
