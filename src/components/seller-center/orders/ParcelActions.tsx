'use client';

import { cn } from '@/lib/utils';
import type { ParcelAction } from '@/modules/orders/contracts';

type ParcelActionsProps = {
  actions: ParcelAction[];
  onAction: (id: string) => void;
  /**
   * `stacked` is the list card's narrow action column: buttons full width,
   * primary filled. `inline` is the detail page's action strip, where the
   * controls sit in a row and are all outlined - a filled button there would
   * compete with the page's own primary actions for the same attention.
   *
   * An explicit prop rather than a `className` override, because the two
   * layouts need opposite `flex-direction` values and passing both leaves
   * Tailwind to resolve a conflict by stylesheet order.
   */
  layout?: 'stacked' | 'inline';
};

/**
 * Up to two actions for one parcel, primary first.
 *
 * A blocked action keeps its slot and its full control height, rendered as a
 * disabled block carrying the reason as its text. An action that vanishes
 * looks like a missing feature and sends the seller hunting; one that says
 * "Wallet balance too low to pay supplier" has already answered the question
 * they were about to ask. It stays the same size as a live button so the row
 * does not reflow between states.
 */
export default function ParcelActions({
  actions,
  onAction,
  layout = 'stacked',
}: ParcelActionsProps) {
  if (actions.length === 0) return null;

  const inline = layout === 'inline';

  const ordered = [...actions].sort((a, b) => {
    if (a.variant === b.variant) return 0;

    return a.variant === 'primary' ? -1 : 1;
  });

  return (
    <div
      className={cn(
        'flex',
        inline ? 'flex-wrap items-center gap-2' : 'flex-col gap-2',
      )}
    >
      {ordered.map((action) => {
        if (action.blockedReason !== null) {
          return (
            <span
              key={action.id}
              aria-disabled="true"
              title={action.blockedReason}
              className={cn(
                'flex h-[34px] cursor-not-allowed items-center justify-center rounded-md border border-border bg-surface text-center text-[11.5px] leading-[1.25] font-medium text-ink-faint',
                inline ? 'px-3.5' : 'px-2',
              )}
            >
              {action.blockedReason}
            </span>
          );
        }

        // In the strip every control is outlined. A filled button there would
        // compete with the page's own primary actions, and the strip is a
        // list of what is possible rather than a recommendation of one.
        if (action.variant === 'primary' && !inline) {
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => onAction(action.id)}
              className="h-[34px] cursor-pointer rounded-md bg-primary text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-brand-900"
            >
              {action.label}
            </button>
          );
        }

        return (
          <button
            key={action.id}
            type="button"
            onClick={() => onAction(action.id)}
            className={cn(
              'flex h-[34px] cursor-pointer items-center justify-center rounded-md border border-border bg-card text-[12.5px] font-medium text-ink-muted transition-colors hover:border-border-strong hover:text-ink',
              inline ? 'px-3.5' : '',
            )}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
