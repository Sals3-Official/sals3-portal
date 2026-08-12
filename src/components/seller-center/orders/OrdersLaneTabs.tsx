import Link from 'next/link';
import { cn } from '@/lib/utils';

export type LaneTab = {
  key: string;
  label: string;
  /** `null` renders no count at all - see `LaneDefinition.showsCount`. */
  count: number | null;
  accent?: boolean;
};

type OrdersLaneTabsProps = {
  lanes: LaneTab[];
  active: string;
  hrefFor: (key: string) => string;
};

/**
 * Lane tabs.
 *
 * Plain links, not client state: the lane lives in the URL so the view stays
 * shareable and the back button behaves - the same reason the chip row and the
 * rest of this workspace work that way.
 *
 * The strip scrolls horizontally rather than wrapping. Seven lanes wrapping to
 * a second row on a narrow window would push the whole list down and read as
 * two unrelated groups of tabs.
 */
export default function OrdersLaneTabs({
  lanes,
  active,
  hrefFor,
}: OrdersLaneTabsProps) {
  return (
    <nav
      aria-label="Order lanes"
      className="-mb-px flex gap-1 overflow-x-auto border-b border-border"
    >
      {lanes.map((lane) => {
        const isActive = lane.key === active;

        return (
          <Link
            key={lane.key}
            href={hrefFor(lane.key)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
              isActive
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {lane.label}
            {lane.count === null ? null : (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                  lane.accent === true
                    ? 'bg-warning-surface text-amber-600'
                    : 'bg-muted text-ink-muted',
                )}
              >
                {lane.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
