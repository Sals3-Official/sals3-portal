import { cn } from '@/lib/utils';
import type { NavBadge } from '@/lib/portal/navigation';

type NavCountBadgeProps = {
  badge: NavBadge;
  /**
   * `rail` sits on the dark sidebar surface (a neutral count is a muted
   * light numeral); `menu` sits on the light flyout/popover surface (a
   * neutral count is a muted dark numeral). Coloured pills (warning/danger)
   * look the same in both - they carry their own surface.
   */
  surface: 'rail' | 'menu';
};

/**
 * Only a count worth acting on gets a coloured pill - a purely informational
 * total renders as a plain muted numeral instead, so urgency stays scarce
 * (the rail's own rule, confirmed against the approved prototype markup).
 */
export default function NavCountBadge({ badge, surface }: NavCountBadgeProps) {
  if (badge.tone === 'neutral') {
    return (
      <span
        className={cn(
          'ml-auto shrink-0 text-[11px] tabular-nums',
          surface === 'rail'
            ? 'text-sidebar-foreground/50'
            : 'text-muted-foreground',
        )}
      >
        {badge.count}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'ml-auto inline-flex shrink-0 items-center rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums',
        badge.tone === 'warning' && 'bg-warning-surface text-amber-600',
        badge.tone === 'danger' && 'bg-danger-surface text-red-600',
      )}
    >
      {badge.count}
    </span>
  );
}
