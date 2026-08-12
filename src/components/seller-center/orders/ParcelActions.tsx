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
  className,
}: ParcelActionsProps) {
  if (actions.length === 0) return null;

  const ordered = [...actions].sort((a, b) => {
    if (a.variant === b.variant) return 0;

    return a.variant === 'primary' ? -1 : 1;
  });

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {ordered.map((action) => {
        if (action.blockedReason !== null) {
          return (
            <span
              key={action.id}
              aria-disabled="true"
              className="flex h-[34px] cursor-not-allowed items-center justify-center rounded-md border border-border bg-muted px-2 text-center text-[11.5px] leading-[1.25] font-medium text-ink-faint"
            >
              {action.blockedReason}
            </span>
          );
        }

        if (action.variant === 'primary') {
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
            className="flex h-[34px] cursor-pointer items-center justify-center rounded-md border border-border text-[12.5px] font-medium text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
