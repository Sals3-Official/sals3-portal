'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { BuyerIdentity, ParcelRoute } from '@/modules/orders/contracts';

type ParcelBuyerCardProps = {
  buyer: BuyerIdentity;
  route: ParcelRoute;
};

/**
 * Buyer contact and delivery, masked until revealed.
 *
 * One control swaps all three values at once. Splitting it into three would
 * let someone reveal an address while believing the phone was still hidden,
 * and the point of the control is that the seller knows exactly what is on
 * screen.
 *
 * The state is local and unpersisted on purpose - it resets on every load, so
 * a tab left open does not sit there with a customer's address exposed.
 *
 * When `revealed` is null the control is absent rather than disabled. A
 * greyed-out button still announces that the data exists and that this person
 * is being refused it; nothing is a cleaner answer than that.
 */
export default function ParcelBuyerCard({
  buyer,
  route,
}: ParcelBuyerCardProps) {
  const [revealed, setRevealed] = useState(false);
  // Narrowed to a local so TypeScript keeps the guarantee through the JSX: if
  // this is non-null the real values exist, and there is no branch below that
  // can read them otherwise.
  const shown = revealed ? buyer.revealed : null;
  const canReveal = buyer.revealed !== null;

  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold">
          Buyer and delivery
        </h2>
        {canReveal ? (
          <button
            type="button"
            aria-pressed={revealed}
            onClick={() => setRevealed((current) => !current)}
            className={cn(
              'h-[30px] cursor-pointer rounded-md border px-3 text-[12.5px] font-semibold transition-colors',
              revealed
                ? 'border-primary text-primary'
                : 'border-border text-ink-muted hover:border-border-strong',
            )}
          >
            {revealed ? 'Hide contact details' : 'Reveal contact details'}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-3.5">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="text-[11.5px] font-semibold tracking-[0.05em] text-ink-faint uppercase">
            Buyer
          </span>
          <span className="text-[13.5px] font-medium text-ink tabular-nums">
            {shown === null ? buyer.maskedName : shown.name}
          </span>
          <span className="text-[12.5px] text-ink-subtle">
            {shown === null ? buyer.maskedPhone : shown.phone}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="text-[11.5px] font-semibold tracking-[0.05em] text-ink-faint uppercase">
            Delivery address
          </span>
          <span className="text-[13px] leading-normal text-ink-muted">
            {shown === null ? buyer.maskedAddress : shown.address}
          </span>
          {buyer.addressLabel === null ? null : (
            <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-muted">
              {buyer.addressLabel}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="text-[11.5px] font-semibold tracking-[0.05em] text-ink-faint uppercase">
            Service level
          </span>
          <span className="text-[13.5px] font-medium text-ink">
            {route.serviceLevel}
          </span>
          <span className="text-[12.5px] text-ink-subtle">
            {route.kind === 'SUPPLIER_DROPSHIP'
              ? 'Carrier assigned by supplier'
              : (route.carrier ?? 'Awaiting carrier assignment')}
          </span>
        </div>
      </div>

      {/*
        The prototype's copy claimed "revealing is recorded against your
        account". No audit trail exists yet, and a privacy control that
        overstates its own safeguards is worse than one that says nothing -
        it invites the seller to trust a protection that is not there.
      */}
      <p className="max-w-[70ch] text-[12px] leading-normal text-ink-faint">
        {canReveal
          ? 'Contact details stay masked until you reveal them, and mask again on every reload.'
          : 'Contact details are masked. Revealing them needs order fulfilment access.'}
      </p>
    </section>
  );
}
