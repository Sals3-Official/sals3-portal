import type { SellerSoldRow } from '@/modules/orders/seller-sold-read';

type SoldShareBarsProps = {
  rows: SellerSoldRow[];
  totalUnits: number;
};

/** Rows shown individually before the remainder is folded into one bar. */
const TOP_ROWS = 5;

export function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

function Bar({ share, lead }: { share: number; lead: boolean }) {
  return (
    <span className="h-2 overflow-hidden rounded-full bg-muted">
      <span
        className={`block h-full rounded-full ${lead ? 'bg-brand-600' : 'bg-border-strong'}`}
        style={{ width: `${share.toFixed(1)}%` }}
      />
    </span>
  );
}

/**
 * Which products the account's units actually went to.
 *
 * ## The bar width is the number printed beside it
 *
 * Each bar is drawn to its share of the account total, which is exactly what
 * its label says. Scaling to the largest row instead would make the top bar
 * full-width while labelled 31.6%, and a chart whose geometry disagrees with
 * its own label is worse than no chart at all.
 *
 * ## Everything below the top five is folded in, not dropped
 *
 * A truncated list whose percentages stop at 89.8% invites the reader to wonder
 * where the rest went. One "N more products" row keeps the column summing to
 * 100 and costs a line.
 */
export default function SoldShareBars({
  rows,
  totalUnits,
}: SoldShareBarsProps) {
  if (rows.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-ink-subtle">
        This fills in on its own the moment a payment clears.
      </p>
    );
  }

  const top = rows.slice(0, TOP_ROWS);
  const rest = rows.slice(TOP_ROWS);
  const restUnits = rest.reduce((total, row) => total + row.units, 0);

  return (
    <>
      {top.map((row, index) => (
        <div
          key={row.productId}
          className="grid grid-cols-[1fr_5.5rem_2.75rem] items-center gap-2.5"
        >
          <span className="truncate text-xs text-ink-muted">{row.title}</span>
          <Bar share={percentOf(row.units, totalUnits)} lead={index === 0} />
          <span className="text-right text-[0.6875rem] text-ink-subtle tabular-nums">
            {percentOf(row.units, totalUnits).toFixed(1)}%
          </span>
        </div>
      ))}

      {rest.length === 0 ? null : (
        <div className="grid grid-cols-[1fr_5.5rem_2.75rem] items-center gap-2.5">
          <span className="truncate text-xs text-ink-faint italic">
            {rest.length} more {rest.length === 1 ? 'product' : 'products'}
          </span>
          <Bar share={percentOf(restUnits, totalUnits)} lead={false} />
          <span className="text-right text-[0.6875rem] text-ink-subtle tabular-nums">
            {percentOf(restUnits, totalUnits).toFixed(1)}%
          </span>
        </div>
      )}
    </>
  );
}
