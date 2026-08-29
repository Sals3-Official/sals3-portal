import { formatMinorUnits } from '@/lib/products/catalog-presentation';
import type {
  SellerSoldRow,
  SellerSoldSummary,
} from '@/modules/orders/seller-sold-read';
import { percentOf } from './SoldShareBars';

type SoldHighlightsProps = {
  summary: SellerSoldSummary;
  rows: SellerSoldRow[];
};

/**
 * A tie is never announced as a winner.
 *
 * With two products level at the top there is no best seller yet, and naming
 * one would be a claim the data does not support — the same discipline the
 * rating band follows when it refuses to average a single review into a trend.
 */
function BestSeller({
  rows,
  totalUnits,
}: {
  rows: SellerSoldRow[];
  totalUnits: number;
}) {
  if (rows.length === 0) {
    return (
      <span className="text-xs text-ink-subtle">
        Named after the first sale.
      </span>
    );
  }

  const leaders = rows.filter((row) => row.units === rows[0].units);

  if (leaders.length > 1) {
    return (
      <>
        <span className="text-xs leading-snug font-semibold text-ink">
          {leaders.length} products tied on {rows[0].units} units
        </span>
        <span className="text-[0.6875rem] text-ink-subtle">
          Named once one is genuinely ahead.
        </span>
      </>
    );
  }

  return (
    <>
      <span className="text-xs leading-snug font-semibold text-ink">
        {rows[0].title}
      </span>
      <span className="text-[0.6875rem] text-ink-subtle tabular-nums">
        {rows[0].units} units &middot;{' '}
        {percentOf(rows[0].units, totalUnits).toFixed(1)}% of everything sold
      </span>
    </>
  );
}

/**
 * The three figures on the band's right edge: what the sales were worth, what
 * leads, and the one that crosses into the other tab.
 *
 * "Sold, not reviewed" is the only number in the Seller Center that says which
 * products earn a review request. Because a sale is not counted until the
 * parcel lands, every product it names is one a buyer is already holding.
 */
/** Two genuinely different states, so an if rather than a nested ternary. */
function reviewPromptCopy(
  unreviewedCount: number,
  unreviewedUnits: number,
): string {
  if (unreviewedCount === 0) {
    return 'Every product that has sold has at least one review.';
  }

  return `${unreviewedUnits.toLocaleString('en-US')} units between them, no review yet. Every one of these has reached a buyer who could write one.`;
}

export default function SoldHighlights({ summary, rows }: SoldHighlightsProps) {
  // Every row here has already arrived — a sale is not counted until the parcel
  // lands — so an unreviewed product is one a real buyer is holding and could
  // write about today. That is what makes this tile actionable rather than a
  // list of parcels in the air.
  const unreviewed = rows.filter((row) => row.reviewCount === 0);
  const unreviewedUnits = unreviewed.reduce(
    (total, row) => total + row.units,
    0,
  );
  const revenue = summary.revenueByCurrency[0];
  const arrivedCopy = reviewPromptCopy(unreviewed.length, unreviewedUnits);

  return (
    <div className="flex flex-col border-border lg:border-l">
      <div className="flex items-center justify-between gap-2.5 border-b border-border px-4 py-3">
        <span className="text-xs text-ink-muted">Revenue</span>
        <span className="font-display text-[1.0625rem] font-semibold text-ink tabular-nums">
          {revenue === undefined
            ? '—'
            : formatMinorUnits(revenue.revenueMinor, revenue.currency)}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
        <span className="text-xs text-ink-muted">Best seller</span>
        <BestSeller rows={rows} totalUnits={summary.totalUnits} />
      </div>

      <div className="flex flex-col gap-1 bg-warning-surface px-4 py-3">
        <div className="flex items-center justify-between gap-2.5">
          <span className="text-xs text-ink-muted">Sold, not reviewed</span>
          <span className="font-display text-[1.0625rem] font-semibold text-ink tabular-nums">
            {unreviewed.length}
          </span>
        </div>
        <span className="text-[0.6875rem] leading-normal text-ink-subtle">
          {arrivedCopy}
        </span>
      </div>
    </div>
  );
}
