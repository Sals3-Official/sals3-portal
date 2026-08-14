import { Info } from 'lucide-react';
import { formatDateTime } from '@/lib/seller-center/product-editor/format';
import type { MarketEvidenceFixture } from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import { MARKET_ELIGIBILITY_PRESENTATION } from './presentation';

type MarketShippingEvidenceProps = {
  markets: MarketEvidenceFixture[];
  marketsNotEnabledCount: number;
};

/**
 * Current market eligibility evidence. No landed-cost math or delivery promise
 * is rendered in the Product Editor.
 */
export default function MarketShippingEvidence({
  markets,
  marketsNotEnabledCount,
}: MarketShippingEvidenceProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Current market eligibility evidence for this supplier product. There are
        no shipping-price controls on this screen.
      </p>

      <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-accent px-3 py-2.5 text-xs leading-relaxed text-brand-900">
        <Info
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-primary"
        />
        Publication and checkout run server-side checks before the product is
        offered to customers.
      </p>

      <ul className="flex list-none flex-col gap-3 p-0">
        {markets.map((market) => {
          const presentation =
            MARKET_ELIGIBILITY_PRESENTATION[market.eligibility];
          const rows: Array<[string, string]> = [
            ['Affected variants', market.affectedVariantsLabel],
            ['Package weight', market.packageWeightLabel],
            ['Evidence captured', formatDateTime(market.evidenceCapturedAt)],
          ];

          return (
            <li
              key={market.code}
              className="rounded-lg border border-border bg-card p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{market.name}</h3>
                {market.isSampleMarket ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                    Sample market
                  </span>
                ) : null}
                <EditorStatusPill presentation={presentation} />
              </div>

              <dl className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-2.5 text-xs @xl:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-semibold text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="mt-0.5 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              {market.note === null ? null : (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {market.note}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {marketsNotEnabledCount === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          Other markets are not evaluated because they are not enabled for this
          seller.
        </p>
      )}

      <div className="rounded-lg border border-border p-3 text-xs text-ink-muted">
        <h4 className="mb-2 text-xs font-bold">
          Three different things, kept separate
        </h4>
        <ul className="m-0 list-disc pl-4 leading-relaxed">
          <li>
            Product / variant eligibility - whether policy and data allow this
            item in a market.
          </li>
          <li>
            Supplier evidence - stock, cost, and source facts captured from the
            supplier.
          </li>
          <li>
            Final checkout validation - current server-side checks before any
            customer purchase.
          </li>
        </ul>
      </div>

      {markets.every((market) => market.isSampleMarket) ? (
        <p className="text-xs text-muted-foreground">
          Sample market A and B are placeholder fixture markets for interface
          review. No destination market has been approved, so no real country is
          hardcoded here.
        </p>
      ) : null}
    </div>
  );
}
