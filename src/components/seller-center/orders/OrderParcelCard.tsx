'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { cn } from '@/lib/utils';
import type {
  OrderParcel,
  ParcelRoute,
  ParcelStatusTone,
} from '@/modules/orders/contracts';

type OrderParcelCardProps = {
  parcel: OrderParcel;
  selected: boolean;
  onToggle: (id: string) => void;
  actionsSlot: ReactNode;
};

/**
 * The card header carries the status tone as a wash, so a long list is
 * scannable by colour before a word is read.
 *
 * The hue maps to what the seller has to do, not to the lane:
 *
 * - blue  - yours to act on now (to process)
 * - grey  - in flight or closed, nothing to do (unpaid, shipping, returns)
 * - green - finished well (delivered)
 * - amber - anomaly being reconciled, watch it (tracking conflict)
 * - red   - blocked, and only you can unblock it (awaiting supplier funds)
 *
 * Every wash reuses a `StatusPill` surface token, so the header and the pill
 * inside it are the same hue rather than two colour systems on one card. All
 * five clear 4.5:1 against `text-ink-subtle`, and the status label always
 * states the state in words - colour is never the only signal.
 *
 * Selection overrides the wash. A selected row has to read as selected first:
 * the bulk bar acts on that set, so which rows are in it must never be
 * ambiguous.
 */
const HEADER_TONE_STYLES: Record<ParcelStatusTone, string> = {
  neutral: 'bg-muted',
  info: 'bg-brand-100',
  success: 'bg-success-surface',
  warning: 'bg-warning-surface',
  danger: 'bg-danger-surface',
};

const HANDOVER_LABELS: Record<
  NonNullable<Extract<ParcelRoute, { kind: 'OWN_STOCK' }>['handover']>,
  string
> = {
  DROP_OFF: 'Drop-off',
  PICK_UP: 'Pickup',
  DROP_OFF_OR_PICK_UP: 'Drop-off or pickup',
};

/**
 * Route lines, in the order a seller reads them: what was promised, who is
 * carrying it, how it leaves.
 *
 * Before a carrier is assigned there is no name to print, and a blank line
 * there reads as missing data rather than as a step that has not happened
 * yet. Saying so explicitly matches what the status sentence already said.
 */
function routeLines(route: ParcelRoute): string[] {
  const lines = [
    route.serviceLevel,
    route.carrier ?? 'Awaiting carrier assignment',
  ];

  if (route.kind === 'OWN_STOCK') {
    if (route.handover !== null) lines.push(HANDOVER_LABELS[route.handover]);
  } else {
    lines.push(`Fulfilled by ${route.supplierLabel}`);
  }

  return lines;
}

/**
 * One parcel.
 *
 * Four columns on desktop - items, route, status, actions - separated by
 * rules, with the money on a footer rather than in a column of its own. That
 * split is deliberate: the top half is the parcel as a physical thing to act
 * on, and the footer is what it is worth. Keeping them apart is also what
 * makes room for supplier spend to sit below a dashed divider, visibly outside
 * the buyer-payment line rather than beneath it in the same column, since
 * ADR-008 keeps the two money rails independent.
 *
 * On a narrow screen the columns stack and the rules become top borders, so
 * the reading order is unchanged.
 */
export default function OrderParcelCard({
  parcel,
  selected,
  onToggle,
  actionsSlot,
}: OrderParcelCardProps) {
  const { money, route } = parcel;

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <header
        className={cn(
          'flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 text-[12.5px] text-ink-subtle',
          selected ? 'bg-accent' : HEADER_TONE_STYLES[parcel.status.tone],
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={!parcel.selectable}
          onChange={() => onToggle(parcel.id)}
          aria-label={`Select parcel ${parcel.id}`}
          className="size-[15px] cursor-pointer accent-primary disabled:cursor-not-allowed"
        />
        <Link
          href={`/orders/${parcel.id}`}
          className="font-semibold text-ink hover:text-primary hover:underline"
        >
          {parcel.orderRef}
        </Link>
        <span>
          Parcel {parcel.parcelIndex} of {parcel.parcelCount}
        </span>
        <span>{parcel.buyerLabel}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
          {route.kind === 'OWN_STOCK' ? 'In-House' : route.supplierLabel}
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_172px]">
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          {parcel.lines.map((item) => (
            <div key={item.id} className="flex gap-2.5">
              <div
                aria-hidden="true"
                className="size-11 flex-none rounded-md border border-border bg-muted"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium text-ink">
                  {item.title}
                </span>
                <span className="text-[12px] text-ink-subtle">
                  {[item.variation, `×${item.quantity}`]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </span>
                {/* ADR-004 §7: the row is the accepted snapshot, not the live
                    listing. Dating it is what makes that legible weeks later. */}
                <span className="text-[11px] text-ink-faint">
                  {item.acceptedOnLabel}
                </span>
              </div>
            </div>
          ))}
          {parcel.buyerMessage === null ? null : (
            <p className="rounded-md bg-accent px-2.5 py-2 text-[12px] leading-normal text-accent-foreground">
              Buyer message: {parcel.buyerMessage}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-[3px] border-t border-border px-4 py-3.5 text-[12.5px] md:border-t-0 md:border-l">
          {routeLines(route).map((entry, index) => (
            <span
              key={entry}
              className={
                index === 0 ? 'font-medium text-ink' : 'text-ink-subtle'
              }
            >
              {entry}
            </span>
          ))}
          {route.trackingNumber === null ? null : (
            <span className="mt-0.5 self-start rounded-md bg-muted px-[7px] py-0.5 font-mono text-[11px] text-ink-muted">
              {route.trackingNumber}
            </span>
          )}
        </div>

        <div className="flex flex-col items-start gap-[5px] border-t border-border px-4 py-3.5 md:border-t-0 md:border-l">
          <StatusPill label={parcel.status.label} tone={parcel.status.tone} />
          <span className="text-[12px] leading-normal text-ink-subtle">
            {parcel.status.detail}
          </span>
        </div>

        <div className="border-t border-border px-4 py-3.5 md:border-t-0 md:border-l">
          {actionsSlot}
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t border-border px-4 py-2.5 text-[12.5px]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="text-ink-subtle">
            Buyer payment{' '}
            <strong className="font-semibold text-ink">
              {money.buyerPaidLabel}
            </strong>
            {money.wholeOrderNote === null ? null : (
              <span className="ml-1 text-ink-faint">
                {money.wholeOrderNote}
              </span>
            )}
          </span>
          {money.commissionLabel === null ? null : (
            <span className="text-ink-subtle">
              Sals3 commission{' '}
              <span className="text-ink">{money.commissionLabel}</span>
            </span>
          )}
        </div>
        {money.supplierCostLabel === null ? null : (
          <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-2 text-ink-subtle">
            <span className="rounded-[5px] bg-muted px-[7px] py-px text-[11px] font-semibold text-ink-muted">
              Your supplier spend
            </span>
            <span>
              <strong className="font-semibold text-ink">
                {money.supplierCostLabel}
              </strong>
              {money.supplierCostNote === null ? null : (
                <span className="ml-1">{money.supplierCostNote}</span>
              )}
            </span>
          </div>
        )}
      </footer>
    </article>
  );
}
