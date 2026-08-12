import { cn } from '@/lib/utils';
import type {
  MoneyLine,
  SettlementStatement,
  SupplierSpend,
} from '@/modules/orders/contracts';
import AdjustmentsTable from './AdjustmentsTable';

type ParcelMoneyRowProps = {
  settlement: SettlementStatement;
  /** `null` on an own-stock parcel. Renders two cards, not a placeholder. */
  supplierSpend: SupplierSpend | null;
  buyerPaymentNote: string;
};

type MoneyCardProps = {
  eyebrow: string;
  eyebrowClassName: string;
  accentClassName: string;
  heading: string;
  totalLabel: string;
  totalCaption: string | null;
  lines: MoneyLine[];
  footnote: string;
};

function MoneyCard({
  eyebrow,
  eyebrowClassName,
  accentClassName,
  heading,
  totalLabel,
  totalCaption,
  lines,
  footnote,
}: MoneyCardProps) {
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-t-[3px] border-border bg-card p-4',
        accentClassName,
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span
          className={cn(
            'text-[11px] font-semibold tracking-[0.07em] uppercase',
            eyebrowClassName,
          )}
        >
          {eyebrow}
        </span>
        <h3 className="font-display text-[15px] font-semibold">{heading}</h3>
        <span className="font-display text-[26px] font-semibold tracking-[-0.02em] text-ink tabular-nums">
          {totalLabel}
        </span>
        {totalCaption === null ? null : (
          <span className="text-[12px] text-ink-subtle">{totalCaption}</span>
        )}
      </div>

      <div className="flex flex-col gap-[7px] border-t border-border pt-3 text-[12.5px]">
        {lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-3">
            <span className="text-ink-subtle">{line.label}</span>
            <span className="text-ink tabular-nums">{line.valueLabel}</span>
          </div>
        ))}
      </div>

      <p className="text-[12px] leading-normal text-ink-faint">{footnote}</p>
    </article>
  );
}

/**
 * The three money cards.
 *
 * Buyer paid, Sals3 settlement, supplier spend - three peers, three totals,
 * and no number anywhere that spans two of them. That is not a stylistic
 * preference: ADR-008 keeps Sals3 settlement and the seller's own supplier
 * spend on independent rails settling with different counterparties, and the
 * buyer payment belongs to the *order*, which on a split covers a sibling
 * parcel too. Any figure combining them would assert a relationship that does
 * not exist.
 *
 * The separation is structural rather than trusted. This component receives
 * three already-formatted card inputs and never sees a number, so there is
 * nothing here to add up even by accident.
 *
 * `auto-fit` rather than a fixed three columns: inside the narrower content
 * column a hard `grid-cols-3` starves each card to about 174px and wraps the
 * headings above their own totals.
 */
export default function ParcelMoneyRow({
  settlement,
  supplierSpend,
  buyerPaymentNote,
}: ParcelMoneyRowProps) {
  const feeLines = settlement.groups.flatMap((group) =>
    group.lines.filter((line) => line.emphasis === 'sub'),
  );

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold">
          Money on this parcel
        </h2>
        <span className="text-[12px] text-ink-faint">
          Three separate totals. Nothing adds or subtracts across these cards.
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-[18px]">
        <MoneyCard
          eyebrow="Buyer payment"
          eyebrowClassName="text-ink-faint"
          accentClassName="border-t-ink-faint"
          heading="Buyer paid"
          totalLabel={settlement.buyerPayment.valueLabel}
          totalCaption={null}
          lines={settlement.buyerPaymentLines}
          footnote={buyerPaymentNote}
        />

        <MoneyCard
          eyebrow="Sals3 settlement"
          eyebrowClassName="text-primary"
          accentClassName="border-t-primary"
          heading="Your Sals3 settlement"
          totalLabel={settlement.estimatedIncome.valueLabel}
          totalCaption={settlement.estimatedIncome.label}
          lines={feeLines}
          footnote="What Sals3 collects from the buyer and pays out to you. It does not include anything you paid a supplier."
        />

        {supplierSpend === null ? null : (
          <MoneyCard
            eyebrow="Supplier spend"
            eyebrowClassName="text-teal-500"
            accentClassName="border-t-teal-500"
            heading="Your supplier spend"
            totalLabel={supplierSpend.totalLabel}
            totalCaption={supplierSpend.accountLabel}
            lines={supplierSpend.lines}
            footnote={
              supplierSpend.walletStateLabel ??
              'Paid from your own supplier account. It is never deducted from your Sals3 settlement.'
            }
          />
        )}
      </div>

      <div className="mt-1 rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex flex-col gap-1">
          <h3 className="text-[13.5px] font-semibold">Adjustments</h3>
          <span className="text-[12px] text-ink-faint">
            An adjustment lands on the Sals3 settlement only. If one is raised
            later it appears here, and the estimate above becomes final once it
            resolves.
          </span>
        </div>
        <AdjustmentsTable adjustments={settlement.adjustments} />
      </div>
    </section>
  );
}
