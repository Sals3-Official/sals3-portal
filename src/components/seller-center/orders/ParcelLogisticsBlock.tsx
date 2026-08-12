import type { ReactNode } from 'react';
import type { OrderParcel, ParcelRoute } from '@/modules/orders/contracts';

type ParcelLogisticsBlockProps = {
  parcel: OrderParcel;
  /** Own-stock only. `null` renders no courier block at all. */
  courierContactLabel: string | null;
  feedSlot: ReactNode;
};

function routeChips(route: ParcelRoute): string[] {
  const chips = [
    route.serviceLevel,
    route.carrier ?? 'Awaiting carrier assignment',
  ];

  if (route.kind === 'SUPPLIER_DROPSHIP') {
    chips.push(`Fulfilled by ${route.supplierLabel}`);
    if (route.supplierOrderRef !== null) chips.push(route.supplierOrderRef);
  }

  if (route.trackingNumber !== null) chips.push(route.trackingNumber);

  return chips;
}

/**
 * How this parcel physically moves.
 *
 * The courier's name and phone render only for own-stock parcels, where Sals3
 * holds the carrier relationship directly. On a dropship parcel that person is
 * the supplier's third party and their contact details arrive inside a
 * supplier payload, which ADR-004 §3 requires personal data to be stripped
 * from - so there is nothing legitimate to show, and the block is absent
 * rather than empty.
 */
export default function ParcelLogisticsBlock({
  parcel,
  courierContactLabel,
  feedSlot,
}: ParcelLogisticsBlockProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Logistics</h2>

      <p className="mt-2 text-sm">
        Package {parcel.parcelIndex} of {parcel.parcelCount}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {routeChips(parcel.route).map((chip) => (
          <span
            key={chip}
            className="rounded-md bg-muted px-2 py-0.5 text-xs text-ink-muted"
          >
            {chip}
          </span>
        ))}
      </div>

      {courierContactLabel === null ? null : (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-ink-subtle">Assigned courier</p>
          <p className="text-sm">{courierContactLabel}</p>
          <p className="mt-1 text-xs text-ink-faint">
            Shown for In-House parcels only. Sals3 holds the carrier
            relationship directly.
          </p>
        </div>
      )}

      <div className="mt-3 border-t border-border pt-3">
        <p className="text-xs text-ink-subtle">Tracking events</p>
        <div className="mt-2">{feedSlot}</div>
      </div>
    </section>
  );
}
