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
