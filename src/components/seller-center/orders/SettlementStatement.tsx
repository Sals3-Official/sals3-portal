import { cn } from '@/lib/utils';
import type {
  MoneyLine,
  SettlementStatement as Settlement,
} from '@/modules/orders/contracts';
import AdjustmentsTable from './AdjustmentsTable';

type SettlementStatementProps = {
  settlement: Settlement;
};

function MoneyRow({ line }: { line: MoneyLine }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-0.5',
        line.emphasis === 'sub' ? 'text-xs text-ink-subtle' : 'text-sm',
        line.emphasis === 'total' && 'font-medium',
      )}
    >
      <span className="flex items-center gap-1">
        {line.label}
        {line.hint === null ? null : (
          <abbr
            title={line.hint}
            className="inline-flex size-3.5 cursor-help items-center justify-center rounded-full border border-chart-4 text-[9px] leading-none text-chart-4 no-underline"
          >
            ?
          </abbr>
        )}
      </span>
      <span className="shrink-0 tabular-nums">{line.valueLabel}</span>
    </div>
  );
}

/**
 * Rail A: what Sals3 collects from the buyer and pays out to the seller.
 *
 * This card never sees supplier spend. ADR-008 keeps the two money rails
 * independent, and the separation is structural here rather than a convention
 * - `SupplierSpend` is not among this component's props, so no future edit can
 * quietly total the two together.
 *
 * "Estimated seller income" keeps the word Estimated, and the final amount is
 * a separate figure below the adjustments ledger. The two are equal only until
 * an adjustment lands; collapsing them into one number would state a
 * settlement as final before it is.
 */
export default function SettlementStatement({
  settlement,
}: SettlementStatementProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Sals3 settlement</h2>
      <p className="mt-1 text-xs text-ink-faint">
        What Sals3 collects from the buyer and pays out to you.
      </p>

      <details className="group mt-3" open>
        <summary className="cursor-pointer list-none text-xs text-primary hover:underline">
          <span className="group-open:hidden">Show income details</span>
          <span className="hidden group-open:inline">Hide income details</span>
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          {settlement.groups.map((group) => (
            <div key={group.heading}>
              {group.lines.map((line) => (
                <MoneyRow key={line.label} line={line} />
              ))}
            </div>
          ))}
        </div>
      </details>

      <div className="mt-3 border-t border-border pt-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="flex items-center gap-1 text-sm font-medium">
            {settlement.estimatedIncome.label}
            {settlement.estimatedIncome.hint === null ? null : (
              <abbr
                title={settlement.estimatedIncome.hint}
                className="inline-flex size-3.5 cursor-help items-center justify-center rounded-full border border-chart-4 text-[9px] leading-none text-chart-4 no-underline"
              >
                ?
              </abbr>
            )}
          </span>
          <span className="text-base font-semibold tabular-nums text-primary">
            {settlement.estimatedIncome.valueLabel}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-2 text-xs text-ink-subtle">Adjustments</p>
        <AdjustmentsTable adjustments={settlement.adjustments} />
      </div>

      <div className="mt-3 rounded-md bg-accent px-3 py-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-medium text-accent-foreground">
            {settlement.finalAmount.label}
          </span>
          <span className="text-base font-semibold tabular-nums text-accent-foreground">
            {settlement.finalAmount.valueLabel}
          </span>
        </div>
      </div>

      <details className="group mt-3 border-t border-border pt-3">
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4">
          <span className="text-sm font-medium">
            {settlement.buyerPayment.label}
          </span>
          <span className="text-sm tabular-nums">
            {settlement.buyerPayment.valueLabel}
          </span>
        </summary>
        <div className="mt-2">
          {settlement.buyerPaymentLines.map((line) => (
            <MoneyRow key={line.label} line={line} />
          ))}
        </div>
      </details>
    </section>
  );
}
