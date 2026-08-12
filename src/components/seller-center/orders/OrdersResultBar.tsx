import type { ReactNode } from 'react';

type OrdersResultBarProps = {
  /** Caller decides the unit - "6 parcels" here, "2 orders" elsewhere. */
  countLabel: string;
  contextLabel: string | null;
  sortSlot: ReactNode;
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
  sortSlot,
}: OrdersResultBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-0.5">
      <div className="flex items-center gap-3.5">
        <span className="text-[13px] font-semibold text-ink">{countLabel}</span>
        {contextLabel === null ? null : (
          <span className="text-[12.5px] text-ink-faint">{contextLabel}</span>
        )}
      </div>
      {sortSlot}
    </div>
  );
}
