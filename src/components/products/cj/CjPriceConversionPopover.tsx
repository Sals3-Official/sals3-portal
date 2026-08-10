'use client';

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { formatUsdCents } from '@/lib/cj/normalize';

type CjPriceConversionPopoverProps = {
  priceCentsUsd: number;
  audAmount: number | null;
};

/**
 * Click (not hover, so it works on touch) reveal of the same USD supplier
 * price in AUD - Sals3's own temporary seller-facing display currency
 * (ADR-014), not PHP: this Portal browsing screen must not present PHP as
 * its operating-market currency. A plain mid-market reference conversion (no
 * buffer): nobody transacts in AUD here, so there is no rail cost to price
 * in, and it is never resolved through the real customer-storefront pricing
 * function (`src/lib/storefront/fx.ts`) - see `catalog-fx.ts`.
 */
export default function CjPriceConversionPopover({
  priceCentsUsd,
  audAmount,
}: CjPriceConversionPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="font-medium underline decoration-dotted decoration-from-font underline-offset-2 hover:decoration-solid"
          >
            {formatUsdCents(priceCentsUsd)}
          </button>
        }
      />
      <PopoverContent align="start">
        <PopoverTitle>{formatUsdCents(priceCentsUsd)} converted</PopoverTitle>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">AUD (reference)</dt>
          <dd className="text-right font-medium tabular-nums">
            {audAmount === null
              ? '—'
              : `A$${audAmount.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`}
          </dd>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Reference only, at today&apos;s exchange rate - never the final landed
          cost, and not a price CJ charges in that currency.
        </p>
      </PopoverContent>
    </Popover>
  );
}
