import { Info, OctagonAlert, Route } from 'lucide-react';
import {
  NOT_AVAILABLE_LABEL,
  formatDateTime,
  formatMoneyRange,
} from '@/lib/seller-center/product-editor/format';
import type { MarketEvidenceFixture } from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import {
  CHECKOUT_REVALIDATION_COPY,
  MARKET_ELIGIBILITY_PRESENTATION,
} from './presentation';

type MarketShippingEvidenceProps = {
  markets: MarketEvidenceFixture[];
  marketsNotEnabledCount: number;
};

/**
 * Current validated shipping evidence. Evidence only - there is no
 * shipping setting on this screen.
 *
 * Nothing here is a seller policy control: no store shipping default, no
 * product override, no seller-absorbed freight, no free-shipping
 * threshold, no cheapest/fastest routing policy, no courier choice, no
 * Economy/Standard/Express tier. None of those are documented anywhere in
 * this system, so none of them are invented here.
 *
 * IMPLEMENTATION NOTE - downstream behaviour this screen depends on, and
 * deliberately does *not* print for the seller:
 *
 * - Checkout performs fresh server-side validation of stock, variant,
 *   supplier cost and freight.
 * - The customer's actual delivery address and quantity are used, not the
 *   estimates rendered above.
 * - An accepted order creates an immutable `OrderLineSnapshot`.
 * - Later supplier changes must not alter the product representation,
 *   price basis, or selected variant stored in that accepted order
 *   (ADR-007).
 *
 * That is engineering context for whoever wires the real pipeline. The
 * seller-facing equivalent is `CHECKOUT_REVALIDATION_COPY` below, which
 * says the operative part - freight and availability are revalidated at
 * checkout - without reading as an internal note left on screen.
 */
export default function MarketShippingEvidence({
  markets,
  marketsNotEnabledCount,
}: MarketShippingEvidenceProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Current validated shipping evidence for this supplier product. There are
        no shipping settings on this screen — nothing here is a seller policy
        control.
      </p>

      <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-accent px-3 py-2.5 text-xs leading-relaxed text-brand-900">
        <Info
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-primary"
        />
        {CHECKOUT_REVALIDATION_COPY}
      </p>

      <ul className="flex list-none flex-col gap-3 p-0">
        {markets.map((market) => {
          const presentation =
            MARKET_ELIGIBILITY_PRESENTATION[market.eligibility];
          const hasRoute = market.freightEstimate !== null;
          const rows: Array<[string, string]> = [
            ['Affected variants', market.affectedVariantsLabel],
            ['Source warehouse', market.sourceWarehouse],
            ['Package weight', market.packageWeightLabel],
            [
              'Package dimensions',
              market.packageDimensionsLabel ?? NOT_AVAILABLE_LABEL,
            ],
            [
              'Current freight estimate',
              market.freightEstimate === null
                ? NOT_AVAILABLE_LABEL
                : formatMoneyRange(
                    market.freightEstimate.min,
                    market.freightEstimate.max,
                  ),
            ],
            [
              'Estimated delivery',
              market.deliveryRangeLabel ?? NOT_AVAILABLE_LABEL,
            ],
            ['Evidence captured', formatDateTime(market.evidenceCapturedAt)],
          ];

          return (
            <li
              key={market.code}
              className="rounded-lg border border-border bg-card p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{market.name}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                  Sample market
                </span>
                <EditorStatusPill presentation={presentation} />
              </div>

              <dl className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-2.5 text-xs @xl:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt className="font-semibold text-muted-foreground">
                      {label}
                    </dt>
                    <dd
                      className={`mt-0.5 font-medium ${
                        value === NOT_AVAILABLE_LABEL ? 'text-amber-600' : ''
                      }`}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="mt-2.5 flex items-start gap-1.5 text-xs text-ink-muted">
                {hasRoute ? (
                  <Route
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-teal-500"
                  />
                ) : (
                  <OctagonAlert
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 text-red-600"
                  />
                )}
                {market.routeEvidence}
              </p>

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
          Four different things, kept separate
        </h4>
        <ul className="m-0 list-disc pl-4 leading-relaxed">
          <li>
            Product / variant eligibility — whether policy and data allow this
            item in a market.
          </li>
          <li>
            Supplier route availability — whether the supplier can ship it from
            a stocked warehouse today.
          </li>
          <li>
            Current freight estimate — evidence with a capture time, not a
            quote.
          </li>
          <li>
            Final checkout validation — the only figure a customer is charged
            against.
          </li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Sample market A and B are placeholder fixture markets for interface
        review. No destination market has been approved, so no real country is
        hardcoded here.
      </p>
    </div>
  );
}
