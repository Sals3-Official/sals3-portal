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
 * "Delivered, not reviewed" is the only number in the Seller Center that says
 * which products earn a review request today. It counts arrivals, not sales: a
 * parcel still in the air cannot be reviewed at all, so counting it would pad
 * the figure with work nobody can do.
 */
/** Three genuinely different states, so an if-chain rather than nested ternaries. */
function reviewPromptCopy(
  arrivedCount: number,
  unreviewedCount: number,
  unreviewedUnits: number,
): string {
  if (arrivedCount === 0) {
    return 'Nothing has arrived yet, so nobody is able to review anything.';
  }

  if (unreviewedCount === 0) {
    return 'Every product that has arrived has at least one review.';
  }

  return `${unreviewedUnits.toLocaleString('en-US')} delivered units between them, no review yet. These are the ones a buyer could actually review today.`;
}

export default function SoldHighlights({ summary, rows }: SoldHighlightsProps) {
  // Delivered, not merely sold. A product still in the air cannot be reviewed
  // at all, so counting it here would pad the figure with work nobody can do —
  // and this tile exists to name the work that is actually available.
  const arrived = rows.filter((row) => row.deliveredUnits > 0);
  const unreviewed = arrived.filter((row) => row.reviewCount === 0);
  const unreviewedUnits = unreviewed.reduce(
    (total, row) => total + row.deliveredUnits,
    0,
  );
  const inTransit = rows.filter(
    (row) => row.deliveredUnits === 0 && row.reviewCount === 0,
  ).length;
  const revenue = summary.revenueByCurrency[0];
  const arrivedCopy = reviewPromptCopy(
    arrived.length,
    unreviewed.length,
    unreviewedUnits,
  );

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
          <span className="text-xs text-ink-muted">
            Delivered, not reviewed
          </span>
          <span className="font-display text-[1.0625rem] font-semibold text-ink tabular-nums">
            {unreviewed.length}
          </span>
        </div>
        <span className="text-[0.6875rem] leading-normal text-ink-subtle">
          {arrivedCopy}
        </span>
        {inTransit === 0 ? null : (
          <span className="text-[0.6875rem] leading-normal text-ink-faint">
            {inTransit} more {inTransit === 1 ? 'product is' : 'products are'}{' '}
            sold but still in transit, so they are not counted here.
          </span>
        )}
      </div>
    </div>
  );
}
