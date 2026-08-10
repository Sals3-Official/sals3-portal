import { Globe2 } from 'lucide-react';

type MarketNotConfiguredNoticeProps = {
  title?: string;
};

/**
 * Honest replacement for any Seller Center screen whose only data source is
 * the illustrative PH/ID/SG market fixture (`market-config.ts`). Production
 * must never render that sample data as real seller configuration - see
 * `getActiveMarket()`'s doc comment (ADR-014) - so this notice replaces the
 * page instead of falling back to a fictional market's currency, carrier,
 * tax, or payout figures.
 */
export default function MarketNotConfiguredNotice({
  title = 'Market configuration is not available',
}: MarketNotConfiguredNoticeProps) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-sm text-muted-foreground">
      <Globe2 aria-hidden="true" className="size-6 text-ink-faint" />
      <h2 className="font-display text-base font-semibold text-foreground">
        {title}
      </h2>
      <p>
        No real per-seller market (currency, carrier, tax, payout rail) is
        configured for this account yet. This is separate from Sals3&apos;s own
        Australian business registration, and this screen never falls back to a
        sample country as if it were real configuration.
      </p>
    </div>
  );
}
