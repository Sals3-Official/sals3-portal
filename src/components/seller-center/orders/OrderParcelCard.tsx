'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { cn } from '@/lib/utils';
import type { OrderParcel, ParcelRoute } from '@/modules/orders/contracts';

type OrderParcelCardProps = {
  parcel: OrderParcel;
  selected: boolean;
  onToggle: (id: string) => void;
  actionsSlot: ReactNode;
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
 * The route cell degrades rather than going blank.
 *
 * Before a carrier is assigned there is no carrier name to print, and an empty
 * cell there reads as missing data. Saying so explicitly is the honest version
 * and matches what the status sentence already told the seller.
 */
function routeLines(route: ParcelRoute): string[] {
  const lines = [route.serviceLevel];

  lines.push(route.carrier ?? 'Awaiting carrier assignment');

  if (route.kind === 'OWN_STOCK') {
    if (route.handover !== null) lines.push(HANDOVER_LABELS[route.handover]);
  } else {
    lines.push(`Fulfilled by ${route.supplierLabel}`);
    if (route.supplierOrderRef !== null) lines.push(route.supplierOrderRef);
  }

  if (route.trackingNumber !== null) lines.push(route.trackingNumber);

  return lines;
}

/**
 * One parcel.
 *
 * Four columns on desktop, stacking on small screens - the same intent as
 * `OrdersRow`'s responsive collapse, expressed for a card rather than a table
 * row. The route column is the one that drops first: it is reference
 * information, while the status sentence and the actions are what the seller
 * is here to act on.
 *
 * Supplier spend sits below a dashed divider, deliberately outside the block
 * holding buyer payment and commission. ADR-008 keeps Sals3 settlement and the
 * seller's own supplier spend on separate rails, and stacking them in one
 * column would invite reading the difference as profit.
 */
export default function OrderParcelCard({
  parcel,
  selected,
  onToggle,
  actionsSlot,
}: OrderParcelCardProps) {
  const { money, route } = parcel;

  return (
    <article
      className={cn(
        'rounded-lg border border-border bg-card',
        selected && 'border-primary',
      )}
    >
      <header
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-t-lg border-b border-border px-3 py-2',
          selected ? 'bg-accent' : 'bg-muted/40',
        )}
      >
        <Checkbox
          checked={selected}
          disabled={!parcel.selectable}
          onCheckedChange={() => onToggle(parcel.id)}
          aria-label={`Select parcel ${parcel.id}`}
        />
        <Link
          href={`/orders/${parcel.id}`}
          className="text-sm font-medium hover:text-primary hover:underline"
        >
          {parcel.orderRef}
        </Link>
        {parcel.parcelCount > 1 ? (
          <span className="text-xs text-ink-muted">
            Parcel {parcel.parcelIndex} of {parcel.parcelCount}
          </span>
        ) : null}
        <span className="text-xs text-ink-muted">{parcel.buyerLabel}</span>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-xs text-ink-muted">
          {route.kind === 'OWN_STOCK' ? 'My stock' : route.supplierLabel}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {parcel.lines.map((item) => (
            <div key={item.id} className="flex gap-2">
              <div
                aria-hidden="true"
                className="size-10 shrink-0 rounded-md bg-muted"
              />
              <div className="min-w-0">
                <p className="text-sm">{item.title}</p>
                <p className="text-xs text-ink-subtle">
                  {[item.variation, `×${item.quantity}`]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </p>
                {/* ADR-004 §7: this row is the accepted snapshot, not the
                    live listing. Saying when it was accepted is what makes
                    that legible on an order placed weeks ago. */}
                <p className="text-xs text-ink-faint">{item.acceptedOnLabel}</p>
              </div>
            </div>
          ))}
          {parcel.buyerMessage === null ? null : (
            <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-ink-muted">
              Buyer message: {parcel.buyerMessage}
            </p>
          )}
        </div>

        <div className="text-sm">
          <p className="text-xs text-ink-subtle">Buyer payment</p>
          <p className="font-medium tabular-nums">{money.buyerPaidLabel}</p>
          {money.wholeOrderNote === null ? null : (
            <p className="text-xs text-ink-faint">{money.wholeOrderNote}</p>
          )}
          {money.commissionLabel === null ? null : (
            <>
              <p className="mt-1.5 text-xs text-ink-subtle">Sals3 commission</p>
              <p className="text-xs tabular-nums text-ink-muted">
                {money.commissionLabel}
              </p>
            </>
          )}
          {money.supplierCostLabel === null ? null : (
            <div className="mt-2 border-t border-dashed border-border pt-2">
              <p className="text-xs text-ink-subtle">Your supplier spend</p>
              <p className="text-xs tabular-nums text-ink-muted">
                {money.supplierCostLabel}
              </p>
              {money.supplierCostNote === null ? null : (
                <p className="text-xs text-ink-faint">
                  {money.supplierCostNote}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <StatusPill label={parcel.status.label} tone={parcel.status.tone} />
          <p className="text-xs text-ink-muted">{parcel.status.detail}</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="hidden text-xs text-ink-subtle md:block">
            {routeLines(route).map((entry) => (
              <p key={entry}>{entry}</p>
            ))}
          </div>
          {actionsSlot}
        </div>
      </div>
    </article>
  );
}
