import type { SupplierSpend } from '@/modules/orders/contracts';

type SupplierSpendPanelProps = {
  spend: SupplierSpend;
};

/**
 * Rail B: what the seller paid their own supplier.
 *
 * A visually distinct card - dashed border, its own heading and its own total
 * - because it is a different rail, not a continuation of the settlement
 * statement. ADR-008 is explicit that Sals3 neither advances supplier funds
 * nor deducts supplier cost from a payout, so presenting this as another line
 * under "fees and charges" would assert a relationship the architecture
 * forbids.
 *
 * Like `SettlementStatement`, this component cannot see the other rail. There
 * is no combined figure anywhere because nothing is holding both.
 */
export default function SupplierSpendPanel({ spend }: SupplierSpendPanelProps) {
  return (
    <section className="rounded-lg border border-dashed border-border-strong bg-card p-4">
      <h2 className="text-sm font-medium">Your supplier spend</h2>
      <p className="mt-1 text-xs text-ink-faint">
        What you paid your supplier. Kept separate from your Sals3 settlement
        and never deducted from it.
      </p>

      <div className="mt-3 flex flex-col">
        {spend.lines.map((line) => (
          <div
            key={line.label}
            className="flex items-baseline justify-between gap-4 py-0.5 text-xs text-ink-subtle"
          >
            <span>{line.label}</span>
            <span className="shrink-0 tabular-nums">{line.valueLabel}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-border pt-2">
        <span className="text-sm font-medium">{spend.accountLabel}</span>
        <span className="text-sm font-semibold tabular-nums">
          {spend.totalLabel}
        </span>
      </div>

      {spend.walletStateLabel === null ? null : (
        <p className="mt-2 text-xs text-ink-faint">{spend.walletStateLabel}</p>
      )}
    </section>
  );
}
