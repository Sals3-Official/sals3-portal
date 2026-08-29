'use client';

/* eslint-disable react/jsx-no-bind -- the open handler closes over this row's own fetch state. */

import { useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatMoney } from '@/lib/seller-center/product-editor/format';
import pricesByDestinationAction, {
  type PriceByDestinationResult,
} from '@/app/(portal)/listings/price-by-destination-actions';
import type { DestinationPrice } from '@/modules/catalog/products/prices-by-destination';

/**
 * What this variant costs a buyer in each destination, on hover and on
 * keyboard focus.
 *
 * ## The gap it closes
 *
 * `Retail price` showed one number under an unqualified heading, and that number
 * was one destination's — `pricing-guidance.ts` resolves the seller's active
 * profile market and nothing else. The markups genuinely differ: on 2026-08-29
 * the same product carried 200% in AU, PH and FJ and 0% in NZ, US and CA. So a
 * seller reading `$20.70` was reading a price that was true in one country and
 * wrong in three, with nothing on screen saying which.
 *
 * ## Why it fetches instead of being handed the data
 *
 * Six queries per destination per variant. A 27-variant table would be roughly
 * 1,100 queries to render something most sellers never open. Asked once, when
 * asked, and remembered for as long as the row is mounted.
 *
 * ## Why a failure is drawn rather than swallowed
 *
 * A tooltip that renders nothing on error is indistinguishable from one still
 * loading, and from a product that genuinely has no prices. Each of those wants
 * a different response from the seller, so each says so.
 */

type PricePerDestinationProps = {
  variantId: string;
  /** The price already on screen, and the destination it belongs to. */
  children: React.ReactNode;
};

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; destinations: DestinationPrice[] }
  | { status: 'error'; message: string };

/** The seller-facing sentence for each way the action can decline. */
function messageFor(result: Extract<PriceByDestinationResult, { ok: false }>) {
  switch (result.reason) {
    case 'denied':
      return 'You do not have permission to see these prices.';
    case 'rate_limited':
      return 'Too many lookups at once. Try again in a moment.';
    case 'not_found':
      return 'This variant is no longer in your catalogue.';
    default:
      return 'The prices could not be worked out right now.';
  }
}

export default function PricePerDestination({
  variantId,
  children,
}: PricePerDestinationProps) {
  const [state, setState] = useState<State>({ status: 'idle' });

  function handleOpenChange(open: boolean) {
    /*
      Fetched once per mounted row, not once per hover.

      A seller comparing variants moves along a column, and re-asking on every
      pass would turn one question into dozens of six-query runs. Prices only
      change when a rule is saved, and saving one refreshes this page.
    */
    if (!open || state.status !== 'idle') return;

    setState({ status: 'loading' });

    pricesByDestinationAction({ variantId })
      .then((result) => {
        setState(
          result.ok
            ? { status: 'ready', destinations: result.destinations }
            : { status: 'error', message: messageFor(result) },
        );
      })
      .catch(() => {
        setState({
          status: 'error',
          message: 'The prices could not be worked out right now.',
        });
      });
  }

  return (
    <Tooltip onOpenChange={handleOpenChange}>
      {/*
        The trigger is whatever it wraps — the price, or the supplier cost.
        Rendered as a button so it is reachable by keyboard: a tooltip that only
        answers a mouse is a tooltip half the people who need it cannot open.
      */}
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="What this variant costs in each destination"
            className="cursor-help text-left underline decoration-dotted underline-offset-4"
          >
            {children}
          </button>
        }
      />
      <TooltipContent className="max-w-xs">
        <span className="flex flex-col gap-1.5">
          <span className="font-medium">Price in each destination</span>

          {state.status === 'loading' || state.status === 'idle' ? (
            <span className="text-ink-faint">Working them out…</span>
          ) : null}

          {state.status === 'error' ? <span>{state.message}</span> : null}

          {state.status === 'ready' ? (
            <span className="flex flex-col gap-0.5 tabular-nums">
              {state.destinations.map((destination) => (
                <span
                  key={destination.marketCode}
                  className="flex justify-between gap-4"
                >
                  <span>{destination.label}</span>
                  {destination.price === null ? (
                    /*
                      The refusal, not a dash. "No price" and "priced at
                      nothing" are different facts, and the resolver already
                      writes the reason for a seller who has to fix it.
                    */
                    <span className="text-ink-faint">
                      {destination.unavailableLabel ?? 'No price'}
                    </span>
                  ) : (
                    <span className="flex gap-2">
                      <span>{formatMoney(destination.price)}</span>
                      {/*
                        The local figure second and dimmed, never instead of the
                        USD one. ADR-003 phase 1 charges USD everywhere, so the
                        approximation is a sanity check on a shelf price — a
                        seller cannot tell from `$14.79` whether that is sane in
                        Fiji. Absent entirely when no rate source answered,
                        rather than shown as a guess.
                      */}
                      {destination.approximateLocal === null ? null : (
                        <span className="text-ink-faint">
                          ≈ {formatMoney(destination.approximateLocal)}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              ))}
            </span>
          ) : null}

          <span className="text-ink-faint">
            Each destination has its own markup in Market rules, so the same
            product is not the same price everywhere. Charged in USD; local
            amounts are approximate.
          </span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
