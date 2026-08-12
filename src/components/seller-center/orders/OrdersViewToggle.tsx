import Link from 'next/link';
import { cn } from '@/lib/utils';

type OrdersViewToggleProps = {
  active: 'list' | 'detail';
  /** Where "Detail view" goes. `null` disables it - nothing to open. */
  detailHref: string | null;
  listHref: string;
};

/**
 * List / Detail switch in the page header.
 *
 * The design prototype used this to flip between two static screens. Here the
 * two views are real routes, so the control navigates rather than toggling
 * local state - `Detail view` opens the first parcel in the current filtered
 * list, which is what a seller means when they reach for it.
 *
 * When the list is empty there is no parcel to open, so `Detail view` renders
 * as disabled rather than as a link to nowhere.
 */
export default function OrdersViewToggle({
  active,
  detailHref,
  listHref,
}: OrdersViewToggleProps) {
  const base =
    'h-8 rounded-md px-3 text-[12.5px] font-medium leading-8 transition-colors';
  const activeStyle = 'bg-card text-ink shadow-sm';
  const idleStyle = 'text-ink-subtle hover:text-ink';

  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-[3px]">
      <Link
        href={listHref}
        aria-current={active === 'list' ? 'page' : undefined}
        className={cn(base, active === 'list' ? activeStyle : idleStyle)}
      >
        List view
      </Link>
      {detailHref === null ? (
        <span
          aria-disabled="true"
          className={cn(base, 'cursor-not-allowed text-ink-faint')}
        >
          Detail view
        </span>
      ) : (
        <Link
          href={detailHref}
          aria-current={active === 'detail' ? 'page' : undefined}
          className={cn(base, active === 'detail' ? activeStyle : idleStyle)}
        >
          Detail view
        </Link>
      )}
    </div>
  );
}
