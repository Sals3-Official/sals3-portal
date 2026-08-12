import type { AdjustmentRow } from '@/modules/orders/contracts';

type AdjustmentsTableProps = {
  adjustments: AdjustmentRow[];
};

/**
 * The adjustments ledger.
 *
 * Rendered even when empty, with an explicit empty state. An adjustment is
 * what moves estimated income to a final amount, so a seller comparing the two
 * needs to see that nothing has been applied - an absent table would leave
 * them wondering whether adjustments exist and are simply not shown.
 */
export default function AdjustmentsTable({
  adjustments,
}: AdjustmentsTableProps) {
  return (
    <div className="rounded-md border border-border">
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-ink-subtle">
        <span>Date</span>
        <span>Reason</span>
        <span className="text-right">Released amount</span>
      </div>
      {adjustments.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-ink-faint">
          No adjustments have been made to this order.
        </p>
      ) : (
        adjustments.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_2fr_auto] gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0"
          >
            <span className="text-ink-muted">{row.dateLabel}</span>
            <span>{row.reason}</span>
            <span className="text-right tabular-nums">{row.amountLabel}</span>
          </div>
        ))
      )}
    </div>
  );
}
