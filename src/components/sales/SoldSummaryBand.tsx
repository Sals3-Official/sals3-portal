import type {
  SellerSoldRow,
  SellerSoldSummary,
} from '@/modules/orders/seller-sold-read';
import SoldHighlights from './SoldHighlights';
import SoldShareBars from './SoldShareBars';

type SoldSummaryBandProps = {
  summary: SellerSoldSummary;
  rows: SellerSoldRow[];
};

/**
 * The sales band: one headline, the shape behind it, and the numbers a seller
 * can act on.
 *
 * Deliberately the same three-cell anatomy as `ReviewSummaryBand`, because the
 * two sit behind adjacent tabs and a seller should not have to relearn the
 * layout when switching. CSS bar meters again — no chart library ships for six
 * bars, and none is needed.
 *
 * Refunded units appear only when there are some. A permanent "0 refunded" row
 * would spend a line saying nothing on almost every account.
 */
export default function SoldSummaryBand({
  summary,
  rows,
}: SoldSummaryBandProps) {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[14.5rem_1fr_17rem]">
      <div className="flex flex-col gap-2 border-border bg-background p-5 lg:border-r">
        <span className="text-xs font-medium text-ink-subtle">Units sold</span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[2.5rem] leading-none font-semibold text-ink tabular-nums">
            {summary.totalUnits.toLocaleString('en-US')}
          </span>
          <span className="text-[0.9375rem] font-medium text-ink-faint">
            units
          </span>
        </div>
        <span className="text-xs leading-normal text-ink-subtle">
          {summary.totalUnits === 0
            ? 'Nothing has sold yet.'
            : `From ${summary.distinctOrders.toLocaleString('en-US')} paid ${summary.distinctOrders === 1 ? 'order' : 'orders'} across ${summary.productCount} ${summary.productCount === 1 ? 'product' : 'products'}.`}
        </span>
        {summary.refundedUnits === 0 ? null : (
          <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-border pt-2.5">
            <span className="text-[0.6875rem] text-ink-faint">
              Refunded, removed
            </span>
            <span className="text-[0.8125rem] font-semibold text-ink tabular-nums">
              {summary.refundedUnits.toLocaleString('en-US')} units
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-5">
        <span className="text-xs font-medium text-ink-subtle">
          Share of units sold
        </span>
        <SoldShareBars rows={rows} totalUnits={summary.totalUnits} />
      </div>

      <SoldHighlights summary={summary} rows={rows} />
    </div>
  );
}
