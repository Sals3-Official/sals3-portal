import { RATE_SCALE } from './money-math';

/**
 * The platform-owned reference-FX rate (ADR-015 §4) — a market observation
 * sellers cannot alter. This is deliberately NOT `src/lib/storefront/fx.ts`
 * (that module prices real customer-facing storefront checkout in a
 * different currency pair and is a separate, already-reviewed production
 * surface) and NOT `src/lib/products/catalog-fx.ts` (explicitly documented
 * as "design-preview-only" fixture data for the All Supplier Products
 * redesign, not approved production evidence). Reusing either here would
 * misrepresent a preview/unrelated utility as approved commercial-pricing
 * evidence.
 *
 * No reference-FX provider is approved for the Portal's own seller-facing
 * pricing surface today. The only rate this can honestly return is the
 * identity rate for a same-currency pair (no conversion needed at all) —
 * ADR-003 phase 1 is USD-only, so this is also the common case. Any other
 * pair fails closed with `null`, which the resolver turns into
 * `REFERENCE_FX_UNAVAILABLE` rather than inventing a number.
 */

export type ReferenceFxRate = {
  rateScaled: bigint;
  source: 'IDENTITY';
  observedAt: string;
};

export function resolveReferenceFxRate(
  sourceCurrency: string,
  targetCurrency: string,
  now: Date = new Date(),
): ReferenceFxRate | null {
  if (sourceCurrency !== targetCurrency) return null;

  return {
    rateScaled: RATE_SCALE,
    source: 'IDENTITY',
    observedAt: now.toISOString(),
  };
}
