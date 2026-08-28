'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { OrderParcel } from '@/modules/orders/contracts';
import formatParcelMoney from '@/modules/orders/money';
import OrdersBulkActionBar from './OrdersBulkActionBar';
import OrderParcelCard from './OrderParcelCard';
import ParcelActions from './ParcelActions';

type OrdersWorkspaceProps = {
  parcels: OrderParcel[];
};

/**
 * Owns parcel selection so the sticky bulk-action bar and the checkboxes stay
 * in sync.
 *
 * A parcel with `selectable: false` can never enter a batch. That covers both
 * the old locked-row cases and a new one: a dropship parcel has no label for
 * the seller to print, because the seller never handles it. Excluding it is a
 * correctness rule, not a styling choice.
 */
export default function OrdersWorkspace({ parcels }: OrdersWorkspaceProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();

  const selectedParcels = parcels.filter((parcel) => selected.has(parcel.id));
  // Refuses to add two currencies together rather than producing a sum that
  // means nothing. One selection can span orders, and orders carry their own
  // currency; a single number over mixed currencies would be a fabrication
  // dressed as a total.
  const currencies = new Set(selectedParcels.map((parcel) => parcel.currency));
  const buyerPaymentMinor = selectedParcels.reduce(
    (sum, parcel) => sum + parcel.proceedsMinor,
    0,
  );
  const buyerPaymentLabel =
    currencies.size === 1
      ? formatParcelMoney(buyerPaymentMinor, [...currencies][0])
      : 'mixed currencies';

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const handleAction = (parcelId: string, actionId: string) => {
    // `details` is navigation, not a fulfillment effect - the detail route
    // exists, so toasting "not wired to a backend" was simply wrong: it made
    // the most obvious button on the card look broken while the page it should
    // open was already there.
    if (actionId === 'details') {
      router.push(`/orders/${parcelId}`);

      return;
    }

    // Everything else would touch a courier or a supplier wallet, and none of
    // that is built. The toast says so rather than implying it happened.
    toast(`${actionId} is not available for this account yet.`, {
      duration: 5000,
    });
  };

  const handlePrint = () => {
    const previousSelection = new Set(selected);

    setSelected(new Set());

    toast('Label printing is not set up for this account. Nothing was sent.', {
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: () => setSelected(previousSelection),
      },
    });
  };

  if (parcels.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
        No parcels match these filters.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {parcels.map((parcel) => (
        <OrderParcelCard
          key={parcel.id}
          parcel={parcel}
          selected={selected.has(parcel.id)}
          onToggle={toggleOne}
          actionsSlot={
            <ParcelActions
              actions={parcel.actions}
              onAction={(actionId) => handleAction(parcel.id, actionId)}
            />
          }
        />
      ))}

      {selected.size > 0 ? (
        <OrdersBulkActionBar
          selectedCount={selected.size}
          buyerPaymentLabel={buyerPaymentLabel}
          onClear={() => setSelected(new Set())}
          onPrint={handlePrint}
        />
      ) : null}
    </div>
  );
}
