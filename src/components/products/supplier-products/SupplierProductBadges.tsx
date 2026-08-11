import type { DiscoverySignal, StockReviewState } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

/**
 * Compact, factual row badges.
 *
 * Two separate vocabularies that must never be blurred together:
 *
 * - **CJ discovery signals** are supplier ranking observations. `High listed`
 *   in particular comes from CJ's `listedNum`, which CJ documents as the
 *   number of platform LISTINGS - never units sold, orders, or buyers. None
 *   of them mean a product is eligible, in stock, or profitable.
 * - **Stock review** is what a person did or did not check on CJ/MyCJ.
 *   `Stock not checked` is an honest unknown, styled neutrally so it reads as
 *   neither good news nor a failure.
 */

const SIGNAL_LABELS: Record<DiscoverySignal, string> = {
  CJ_TRENDING: 'CJ Trending',
  CJ_HIGH_LISTED: 'High listed',
  CJ_NEW_ARRIVAL: 'New arrival',
};

const SIGNAL_TITLES: Record<DiscoverySignal, string> = {
  CJ_TRENDING:
    'Observed in CJ’s trending list. A supplier signal, not a Sals3 eligibility or demand claim.',
  CJ_HIGH_LISTED:
    'High CJ listedNum: the number of platform listings, not units sold.',
  CJ_NEW_ARRIVAL: 'Recently created on CJ, from the New arrivals lane.',
};

export function DiscoverySignalBadges({
  signals,
}: {
  signals: DiscoverySignal[];
}) {
  if (signals.length === 0) return null;

  return (
    <span className="flex flex-wrap gap-1">
      {signals.map((signal) => (
        <span
          key={signal}
          title={SIGNAL_TITLES[signal]}
          className="inline-flex items-center rounded-full border border-brand-600/30 bg-brand-600/10 px-2 py-0.5 text-[11px] font-medium text-brand-700"
        >
          {SIGNAL_LABELS[signal]}
        </span>
      ))}
    </span>
  );
}

const STOCK_REVIEW_PRESENTATION: Record<
  StockReviewState,
  { label: string; className: string; title: string }
> = {
  STOCK_NOT_CHECKED: {
    label: 'Stock not checked',
    className: 'border-border bg-muted text-ink-muted',
    title:
      'Nobody has inspected this product’s stock yet. Sals3 does not call the CJ inventory API for raw supplier products, so this is an honest unknown - not “in stock” and not a failure.',
  },
  MANUALLY_IN_STOCK: {
    label: 'Manually in stock',
    className: 'border-green-600/30 bg-green-600/10 text-green-700',
    title:
      'A person recorded seeing stock on CJ/MyCJ. This is a staff attestation, not CJ API-verified evidence.',
  },
  MANUALLY_NO_INVENTORY: {
    label: 'Manually: no inventory',
    className: 'border-red-600/30 bg-red-600/10 text-red-700',
    title:
      'A person recorded seeing no inventory on CJ/MyCJ. Recoverable - re-check and record again at any time.',
  },
  MANUALLY_COULD_NOT_VERIFY: {
    label: 'Could not verify',
    className: 'border-amber-600/30 bg-amber-600/10 text-amber-700',
    title:
      'A person tried to check CJ/MyCJ and could not establish the stock position.',
  },
};

export function StockReviewBadge({
  state,
  className,
}: {
  state: StockReviewState;
  className?: string;
}) {
  const presentation = STOCK_REVIEW_PRESENTATION[state];

  return (
    <span
      title={presentation.title}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        presentation.className,
        className,
      )}
    >
      {presentation.label}
    </span>
  );
}

export { STOCK_REVIEW_PRESENTATION };
