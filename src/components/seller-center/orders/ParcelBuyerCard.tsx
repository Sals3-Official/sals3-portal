'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import type {
  BuyerIdentity,
  ParcelRoute,
  RevealedContact,
} from '@/modules/orders/contracts';

type ParcelBuyerCardProps = {
  buyer: BuyerIdentity;
  route: ParcelRoute;
  /** Server action. Returns the real values, or null if there are none. */
  onReveal: () => Promise<RevealedContact | null>;
};

/**
 * Buyer contact and delivery, masked until fetched.
 *
 * The real values are *not* in this component's props. They are fetched from
 * the server on demand, because shipping them alongside the mask and toggling
 * in the browser makes the masking cosmetic - the plaintext sits in the page
 * payload where view-source reads it without anyone clicking, and the
 * permission check decorates a decision already made.
 *
 * One control swaps all three values at once. Splitting it would let someone
 * reveal an address while believing the phone was still hidden, and the point
 * of the control is that the seller knows exactly what is on screen.
 *
 * Nothing is cached beyond this mount: hiding drops the values, and a reload
 * starts masked again, so a tab left open does not sit there with a customer's
 * address exposed.
 */
export default function ParcelBuyerCard({
  buyer,
  route,
  onReveal,
}: ParcelBuyerCardProps) {
  const [shown, setShown] = useState<RevealedContact | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function revealLabel(): string {
    if (pending) return 'Revealing…';

    return shown === null ? 'Reveal contact details' : 'Hide contact details';
  }

  function footnote(): string {
    if (failed) {
      return 'Could not reveal these details. Your account may not have order fulfilment access.';
    }

    return buyer.canReveal
      ? 'Contact details are fetched only when you ask, and mask again on every reload.'
      : 'Contact details are masked. Revealing them needs order fulfilment access.';
  }

  const toggle = () => {
    if (shown !== null) {
      setShown(null);

      return;
    }

    startTransition(async () => {
      try {
        setFailed(false);
        setShown(await onReveal());
      } catch {
        // A refused or failed reveal must not look like "this buyer has no
        // details" - that would read as missing data rather than a boundary.
        setFailed(true);
      }
    });
  };

  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold">
          Buyer and delivery
        </h2>
        {buyer.canReveal ? (
          <button
            type="button"
            aria-pressed={shown !== null}
            disabled={pending}
            onClick={toggle}
            className={cn(
              'h-[30px] cursor-pointer rounded-md border px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-progress',
              shown === null
                ? 'border-border text-ink-muted hover:border-border-strong'
                : 'border-primary text-primary',
            )}
          >
            {revealLabel()}
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
        overstates its own safeguards is worse than one that stays quiet.
      */}
      <p className="max-w-[70ch] text-[12px] leading-normal text-ink-faint">
        {footnote()}
      </p>
    </section>
  );
}
