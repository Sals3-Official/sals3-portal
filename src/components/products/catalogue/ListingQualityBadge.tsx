import { Check, Info, X } from 'lucide-react';
import StatusPill, {
  type StatusPillTone,
} from '@/components/seller-center/shared/StatusPill';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  LISTING_QUALITY_LABELS,
  listingQualityOf,
  listingQualitySignals,
} from '@/lib/seller-center/product-catalogue/listing-quality';
import type { ListingQuality } from '@/lib/seller-center/product-catalogue/listing-quality';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';

type ListingQualityBadgeProps = {
  product: CatalogueProductFixture;
};

/**
 * `LOW` is a warning, not a danger: an unfinished draft is the normal state of
 * new work, not a fault. Danger is reserved in this table for a listing that
 * cannot sell at all.
 */
const TONE_BY_QUALITY: Record<ListingQuality, StatusPillTone> = {
  LOW: 'warning',
  MEDIUM: 'info',
  HIGH: 'success',
};

/**
 * How finished a listing is, with the checklist that produced it.
 *
 * The tooltip lists every signal and whether it is met, because a bare
 * `Medium` tells a seller nothing about what to do next — the whole value of
 * this column is naming the remaining work. Publish-critical gaps are marked so
 * "cannot sell yet" reads differently from "not polished yet".
 *
 * Presentation only: nothing here gates publication (see `listing-quality.ts`).
 */
export default function ListingQualityBadge({
  product,
}: ListingQualityBadgeProps) {
  const quality = listingQualityOf(product);
  const signals = listingQualitySignals(product);
  const label = LISTING_QUALITY_LABELS[quality];
  const remaining = signals.filter((signal) => !signal.met).length;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill label={label} tone={TONE_BY_QUALITY[quality]} />
            <Info
              aria-label={`What listing quality "${label}" means`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>
        <p className="mb-1 font-medium">
          {remaining === 0
            ? 'Every listing check is met.'
            : `${remaining} listing ${remaining === 1 ? 'check' : 'checks'} still to do.`}
        </p>
        <ul className="flex flex-col gap-0.5">
          {signals.map((signal) => (
            <li key={signal.id} className="flex items-center gap-1.5 text-xs">
              {signal.met ? (
                <Check aria-hidden="true" className="size-3 shrink-0" />
              ) : (
                <X aria-hidden="true" className="size-3 shrink-0" />
              )}
              {/* Screen readers get the state as words, not as an icon. */}
              <span className="sr-only">{signal.met ? 'Done:' : 'To do:'}</span>
              <span>{signal.label}</span>
              {!signal.met && signal.publishCritical ? (
                <span className="text-[10px] uppercase tracking-wide">
                  needed to sell
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
