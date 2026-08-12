'use client';

import { cn } from '@/lib/utils';
import type { ParcelAction } from '@/modules/orders/contracts';

type ParcelActionsProps = {
  actions: ParcelAction[];
  onAction: (id: string) => void;
  className?: string;
};

/**
 * Up to two actions for one parcel, primary first.
 *
 * A blocked action renders as disabled text carrying its own reason rather
 * than disappearing. An action that vanishes looks like a missing feature and
 * sends the seller hunting; one that says "Wallet balance too low to pay
 * supplier" has already answered the question they were about to ask.
 *
 * `blockedReason` replaces the label rather than sitting beside it, so the
 * reason occupies the position the eye already goes to.
 */
export default function ParcelActions({
  actions,
  onAction,
  className,
}: ParcelActionsProps) {
  if (actions.length === 0) return null;

  const ordered = [...actions].sort((a, b) => {
    if (a.variant === b.variant) return 0;

    return a.variant === 'primary' ? -1 : 1;
  });

  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      {ordered.map((action) => {
        if (action.blockedReason !== null) {
          return (
            <span
              key={action.id}
              aria-disabled="true"
              className="text-left text-sm text-ink-faint"
            >
              {action.blockedReason}
            </span>
          );
        }

        return (
          <button
            key={action.id}
            type="button"
            onClick={() => onAction(action.id)}
            className={cn(
              'cursor-pointer text-left text-sm transition-colors',
              action.variant === 'primary'
                ? 'font-medium text-primary hover:underline'
                : 'text-ink-muted hover:text-primary',
            )}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
