import { AlertTriangle } from 'lucide-react';
import type {
  CategoryMappingConfidence,
  VariantPricingGuidance,
} from '@/lib/seller-center/product-editor/types';

type PricingBasisPanelProps = {
  categoryPath: string;
  categoryCode: string | null;
  categoryMappingConfidence: CategoryMappingConfidence;
  variantGuidance: VariantPricingGuidance[];
  /** `false` when this draft has no real, persisted candidate id yet — the override actions have nothing real to attach to (see `types.ts#realSupplierCandidateId`). */
  overridesAvailable: boolean;
};

function formatPercent(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

function formatMoney(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

const RESOLVED_LAYER_LABELS: Record<string, string> = {
  CATEGORY: 'Category policy',
  PRODUCT_OVERRIDE: 'Product override',
  VARIANT_OVERRIDE: 'Variant override',
};

/**
 * "Pricing basis" — product-only price guidance from the real, server-side
 * resolver (`resolveProductPricing`). Deliberately never computed in this
 * client: every value here was resolved server-side in `page.tsx` and
 * handed down as plain data, so a seller cannot see a margin/price that
 * the server did not actually authorize.
 *
 * `PRICING_UNAVAILABLE` renders a plain-language reason, never a fabricated
 * price. This mirrors the rest of the Product Editor's "missing evidence
 * reads as words, never zero" rule.
 */
export default function PricingBasisPanel({
  categoryPath,
  categoryCode,
  categoryMappingConfidence,
  variantGuidance,
  overridesAvailable,
}: PricingBasisPanelProps) {
  const mappingNeedsReview =
    categoryMappingConfidence === 'AMBIGUOUS' ||
    categoryMappingConfidence === 'UNMAPPED';

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-background p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Pricing basis</h3>
          <p className="text-xs text-ink-muted">
            {categoryPath}
            {categoryCode === null ? null : (
              <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                ({categoryCode})
              </span>
            )}
          </p>
        </div>
        {!overridesAvailable && (
          <span className="text-xs text-muted-foreground">
            Product/variant overrides need a saved supplier candidate — not
            available in this design preview.
          </span>
        )}
      </div>

      {mappingNeedsReview ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-600/30 bg-warning-surface px-3 py-2 text-sm text-amber-600">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          No CJ category is on record for this product, so it cannot receive
          price guidance.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {variantGuidance.map(({ variantId, optionLabel, decision }) => (
            <div
              key={variantId}
              className="rounded-md border border-border bg-card p-2.5 text-xs"
            >
              <p className="mb-1 font-medium">{optionLabel}</p>
              {decision === null ||
              decision.outcome === 'PRICING_UNAVAILABLE' ? (
                <p className="text-muted-foreground">
                  {decision?.reasonLabel ?? 'Pricing unavailable'}
                </p>
              ) : (
                <dl className="space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Margin</dt>
                    <dd className="tabular-nums">
                      {formatPercent(decision.targetMarginRate)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Suggested price</dt>
                    <dd className="tabular-nums">
                      {formatMoney(
                        decision.roundedSuggestedItemPrice.amountMinor,
                        decision.roundedSuggestedItemPrice.currency,
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Source</dt>
                    <dd>{RESOLVED_LAYER_LABELS[decision.resolvedLayer]}</dd>
                  </div>
                </dl>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        This is product-only price guidance; checkout freight is not included.
        Set a category policy in Settings → Market Rules to enable it.
      </p>
    </div>
  );
}
