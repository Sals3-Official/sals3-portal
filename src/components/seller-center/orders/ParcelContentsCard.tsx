import type { ParcelLine } from '@/modules/orders/contracts';
import ParcelLineThumbnail from './ParcelLineThumbnail';
import ParcelLineTitle from './ParcelLineTitle';

type ParcelContentsCardProps = {
  lines: ParcelLine[];
  /** Read-only until a write path exists. `null` renders the empty state. */
  sellerNote: string | null;
  /**
   * The same figure the money row prints as "Goods", passed in already
   * formatted rather than summed here.
   *
   * Summing the lines in this component would make the footer agree with itself
   * by construction, which is the one thing it must not do: its whole job is to
   * show that the goods total and these lines are the same money. Both now come
   * from `parcelPaidMinor`, so a disagreement is a real disagreement.
   */
  goodsTotalLabel: string;
};

/**
 * What is in the parcel, and the seller's private note about it.
 *
 * The note lives inside this card rather than in one of its own: it is a note
 * about these items, and a separate card would imply it belongs to the order.
 * It is per parcel for the same reason - a split order has two, and a note
 * about the ribbon is not a note about the mailers.
 *
 * Every field here is the accepted snapshot (ADR-004 §7). The delivery window
 * is absent on own-stock parcels because only a supplier gives us one; see
 * `ParcelLine.deliveryRangeLabel`.
 *
 * ## Prices, added 2026-08-31
 *
 * The lines used to carry a quantity and no money, so the only figure on the
 * page was "Goods" in the money row, three sections down and unreconcilable
 * against anything. A seller who thought a total looked wrong had no way to
 * find the line that made it wrong — and that is the question this screen is
 * actually opened to answer.
 *
 * Each line now shows its own total, with the unit price beneath it whenever
 * more than one was ordered, and the card foots to the same goods figure the
 * money row prints.
 */
export default function ParcelContentsCard({
  lines,
  sellerNote,
  goodsTotalLabel,
}: ParcelContentsCardProps) {
  const unitCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-4 py-3.5">
        <h2 className="font-display text-[15px] font-semibold">
          Parcel contents
        </h2>
        <span className="text-[12.5px] text-ink-subtle">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'} · {unitCount}{' '}
          {unitCount === 1 ? 'unit' : 'units'}
        </span>
      </div>

      {lines.map((line) => (
        <div key={line.id} className="flex gap-3.5 px-4 py-4">
          <ParcelLineThumbnail
            imageUrl={line.imageUrl}
            title={line.title}
            size={56}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <ParcelLineTitle
                line={line}
                typographyClassName="text-[14px] font-semibold"
              />
              <div className="flex shrink-0 flex-col items-end">
                <span className="text-[13.5px] font-semibold text-ink tabular-nums">
                  {line.lineTotalLabel}
                </span>
                <span className="text-[11.5px] text-ink-subtle tabular-nums">
                  {line.quantity === 1
                    ? '×1'
                    : `${line.unitPriceLabel} × ${line.quantity}`}
                </span>
              </div>
            </div>
            {line.variation === null ? null : (
              <span className="text-[12.5px] text-ink-subtle">
                {line.variation}
              </span>
            )}
            <div className="flex flex-wrap gap-x-[18px] gap-y-2 text-[12px] text-ink-subtle">
              <span>
                SKU <span className="text-ink tabular-nums">{line.sku}</span>
              </span>
              <span>
                Order line{' '}
                <span className="text-ink tabular-nums">{line.id}</span>
              </span>
              {line.deliveryRangeLabel === null ? null : (
                <span>
                  Supplier estimate{' '}
                  <span className="text-ink">{line.deliveryRangeLabel}</span>
                </span>
              )}
            </div>
            <span className="text-[11.5px] text-ink-faint">
              {line.acceptedOnLabel}
            </span>
          </div>
        </div>
      ))}

      <div className="flex items-baseline justify-between gap-4 border-t border-border px-4 py-3">
        <span className="text-[12.5px] text-ink-subtle">
          Goods on this parcel
        </span>
        <span className="text-[14px] font-semibold text-ink tabular-nums">
          {goodsTotalLabel}
        </span>
      </div>
      {/*
        Named rather than left to be inferred. This figure is the items only,
        and the money row below carries shipping, the Sals3 settlement and the
        supplier spend as three separate totals that are deliberately never
        added together — so a footer that looked like an order total would
        contradict the section under it.
      */}
      <p className="px-4 pb-3 text-[11.5px] text-ink-faint">
        Items only, at the prices charged when the order was placed. Shipping
        and everything else are in Money on this parcel.
      </p>

      <div className="flex flex-col gap-2 px-4 pb-4">
        <span className="text-[11.5px] font-semibold tracking-[0.05em] text-ink-faint uppercase">
          Your note on this parcel
        </span>
        {/*
          Read-only this pass. There is no orders backend and no server action
          behind it, so an editable box with a Save button would be a control
          that quietly discards what the seller typed.
        */}
        {sellerNote === null ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[12.5px] text-ink-faint">
            No note on this parcel. Notes are visible to your team only. Saving
            notes is not available yet.
          </p>
        ) : (
          <p className="rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] leading-normal text-ink">
            {sellerNote}
          </p>
        )}
      </div>
    </section>
  );
}
