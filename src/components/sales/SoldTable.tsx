import type { SellerSoldRow } from '@/modules/orders/seller-sold-read';
import SoldRow, { SOLD_GRID } from './SoldRow';

type SoldTableProps = {
  rows: SellerSoldRow[];
};

const HEADINGS = ['#', 'Item', 'Units sold', 'Orders', 'Revenue', 'Reviews'];

/**
 * Every product with at least one paid sale, best first.
 *
 * Rows are per product rather than per variant: "which of my things sells" is
 * the question this screen answers, and a variant split would bury it. The
 * per-variant breakdown belongs on the product itself, where restocking
 * decisions are actually made.
 *
 * There is no pagination and no sort control yet. Both are easy to add and
 * neither earns its place while an account has a handful of products — a
 * control that does nothing visible is worse than its absence.
 */
export default function SoldTable({ rows }: SoldTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-8 text-border-strong"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
        >
          <path d="M2.4 4.4h11.2l-1 8.2H3.4z" />
          <path d="M5.6 4.4V2.9h4.8v1.5" />
        </svg>
        <span className="font-display text-base font-semibold text-ink">
          Nothing has sold yet
        </span>
        <p className="max-w-[46ch] text-[0.8125rem] leading-relaxed text-ink-subtle">
          This fills in on its own the moment a payment clears. Nothing to set
          up here, and no number on this tab is one you can influence directly.
        </p>
      </div>
    );
  }

  const leaderUnits = rows[0].units;

  return (
    <>
      <div
        className={`${SOLD_GRID} hidden border-b border-border bg-background px-4 py-2.5 md:grid`}
      >
        {HEADINGS.map((heading) => (
          <span key={heading} className="text-xs font-medium text-ink-subtle">
            {heading}
          </span>
        ))}
      </div>

      {rows.map((row, index) => (
        <SoldRow
          key={row.productId}
          row={row}
          rank={index + 1}
          leaderUnits={leaderUnits}
        />
      ))}

      <p className="px-4 py-3.5 text-xs text-ink-subtle">
        Showing {rows.length} of {rows.length}{' '}
        {rows.length === 1 ? 'product' : 'products'} with at least one paid
        sale.
      </p>
    </>
  );
}
