import type { LifecycleEvent } from '@/modules/orders/contracts';

type OrderHistoryTimelineProps = {
  events: LifecycleEvent[];
};

/**
 * Order lifecycle, and only that.
 *
 * Deliberately a different feed from `TrackingEventFeed`. A state transition
 * Sals3 authorised and a carrier scan that arrived from outside are different
 * kinds of fact with different trust: ADR-004 makes transitions server-
 * authorised and auditable, while tracking events are reconciled from
 * competing sources under a documented priority. Merging them into one
 * timeline would present both as equally settled.
 */
export default function OrderHistoryTimeline({
  events,
}: OrderHistoryTimelineProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Order history</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Lifecycle only. Carrier events sit in the tracking feed.
      </p>
      <ol className="mt-3 flex flex-col gap-3">
        {events.map((event) => (
          <li key={event.id} className="flex gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
            />
            <div>
              <p className="text-sm">{event.label}</p>
              <p className="text-xs text-ink-faint">{event.occurredAtLabel}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
