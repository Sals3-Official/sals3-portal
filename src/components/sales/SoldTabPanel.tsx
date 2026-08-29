import type {
  SellerSoldRow,
  SellerSoldSummary,
} from '@/modules/orders/seller-sold-read';
import SoldSummaryBand from './SoldSummaryBand';
import SoldTable from './SoldTable';

type SoldTabPanelProps = {
  summary: SellerSoldSummary;
  rows: SellerSoldRow[];
};

/**
 * The Sold tab: the counting rule, the shape of the account's sales, then every
 * product that has sold.
 *
 * The note is not decoration. A sold count that silently falls when a buyer is
 * refunded reads as a bug to the person watching it, so the rule that makes it
 * fall is stated once, at the top, before the first number.
 */
export default function SoldTabPanel({ summary, rows }: SoldTabPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2.5 rounded-lg border border-border bg-card p-3.5">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="mt-px size-4 shrink-0 text-brand-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 7.2v4M8 4.9v.1" />
        </svg>
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          A sale counts from the moment the payment clears.{' '}
          <strong className="font-semibold text-ink">
            Refunded and disputed lines are removed
          </strong>
          , so this number can go down. Units are what buyers actually ordered,
          so one order of three counts as three.
        </p>
      </div>

      <SoldSummaryBand summary={summary} rows={rows} />

      <div className="rounded-lg border border-border bg-card">
        <SoldTable rows={rows} />
      </div>
    </div>
  );
}
