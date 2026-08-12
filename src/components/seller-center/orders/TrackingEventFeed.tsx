import { cn } from '@/lib/utils';
import type { TrackingEvent } from '@/modules/orders/contracts';

type TrackingEventFeedProps = {
  events: TrackingEvent[];
};

const SOURCE_LABELS: Record<TrackingEvent['source'], string> = {
  CARRIER: 'Carrier',
  SUPPLIER: 'Supplier',
  OPERATIONS: 'Sals3 operations',
};

function TrackingEventRow({ event }: { event: TrackingEvent }) {
  return (
    <div className="flex gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 size-1.5 shrink-0 rounded-full',
          event.isException ? 'bg-amber-600' : 'bg-border-strong',
        )}
      />
      <div className="min-w-0">
        <p
          className={cn(
            'text-sm',
            event.isException ? 'text-amber-600' : 'text-ink',
          )}
        >
          {event.label}
        </p>
        <p className="text-xs text-ink-faint">
          {SOURCE_LABELS[event.source]} · {event.occurredAtLabel}
        </p>
      </div>
    </div>
  );
}

/**
 * Every stored tracking event, newest first.
 *
 * ADR-004 §5 requires storing each source event and reconciling conflicts
 * under a documented priority, so this feed names *which source* said what -
 * a carrier scan and a supplier claim disagreeing is the entire reason the
 * `TRACKING_CONFLICT` state exists, and that is unreadable if both render as
 * anonymous rows.
 *
 * An exception is marked inline and never promoted to the parcel status. A
 * failed pickup attempt is something that happened, not where the parcel now
 * is; overwriting the status with it would lose that distinction.
 *
 * `<details>` rather than `useState`: this stays a Server Component, and the
 * feed expands before hydration.
 */
export default function TrackingEventFeed({ events }: TrackingEventFeedProps) {
  if (events.length === 0) {
    return (
      <p className="text-xs text-ink-faint">
        No tracking events yet. They appear once the carrier scans the parcel.
      </p>
    );
  }

  const [latest, ...rest] = events;

  return (
    <div className="flex flex-col gap-2">
      <TrackingEventRow event={latest} />
      {rest.length === 0 ? null : (
        <details className="group">
          <summary className="cursor-pointer list-none text-xs text-primary hover:underline">
            <span className="group-open:hidden">
              Expand {rest.length} earlier event
              {rest.length === 1 ? '' : 's'}
            </span>
            <span className="hidden group-open:inline">Collapse</span>
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {rest.map((event) => (
              <TrackingEventRow key={event.id} event={event} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
