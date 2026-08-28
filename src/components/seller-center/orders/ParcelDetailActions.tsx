'use client';

import { toast } from 'sonner';
import type { ParcelAction } from '@/modules/orders/contracts';
import ParcelActions from './ParcelActions';

type ParcelDetailActionsProps = {
  actions: ParcelAction[];
  parcelId: string;
};

/**
 * Client boundary for the detail page's action strip.
 *
 * Exists only so the surrounding page can stay a Server Component. No action
 * in this slice performs a real fulfillment effect, and the toast says so
 * rather than implying a courier was booked or a supplier was paid.
 */
export default function ParcelDetailActions({
  actions,
  parcelId,
}: ParcelDetailActionsProps) {
  // An empty strip under a "What you can do next" heading reads as a control
  // that failed to load. Saying there is nothing is shorter and true, and it
  // names why rather than leaving the seller to wonder what is missing.
  if (actions.length === 0) {
    return (
      <p className="text-[12.5px] text-ink-subtle">
        Nothing to arrange — your supplier despatches this parcel. Courier
        handover and label printing are not configured for this account.
      </p>
    );
  }

  return (
    <ParcelActions
      actions={actions}
      layout="inline"
      onAction={(actionId) =>
        toast(`"${actionId}" on ${parcelId} is not wired to a backend yet.`, {
          duration: 5000,
        })
      }
    />
  );
}
