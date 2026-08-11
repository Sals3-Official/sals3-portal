import getDb from '@/lib/db/client';
import { resolveProductPricing } from '@/modules/pricing/resolver';
import type { ProductEditorFixture, VariantPricingGuidance } from './types';

/** ADR-003 phase 1: the only settlement currency the pipeline supports today. */
const SETTLEMENT_CURRENCY = 'USD';

/**
 * Resolves real, server-side price guidance for every variant on a Product
 * Editor fixture, via the real `resolveProductPricing` resolver — never
 * computed in the browser, never a fabricated number.
 *
 * Catches its own failure and degrades to `decision: null` per variant
 * rather than throwing: the pricing-policy schema (migration 0010) is
 * deliberately unapplied in some environments during this rollout, and a
 * missing-table error here must never take down the whole editor. This is
 * the same discipline `connectCjSupplier`'s own comment describes for a
 * prior real incident (a table reaching a deployment before its
 * migration) — the failure surfaces as an honest "unavailable" panel
 * rather than a crashed page.
 */
export default async function resolveFixtureVariantGuidance(
  fixture: ProductEditorFixture,
  sellerAccountId: string,
): Promise<VariantPricingGuidance[]> {
  const db = getDb();

  return Promise.all(
    fixture.variants.map(async (variant) => {
      try {
        const decision = await resolveProductPricing(db, {
          sellerAccountId,
          categoryCode: fixture.sals3CategoryCode,
          categoryMappingConfidence: fixture.categoryMappingConfidence,
          supplierCandidateId: fixture.realSupplierCandidateId,
          supplierVariantId: variant.supplierVariantId,
          supplierCost: variant.supplierCost,
          supplierCostObservedAt: variant.evidenceCapturedAt,
          settlementCurrency: SETTLEMENT_CURRENCY,
          fundingRail: null,
        });

        return {
          variantId: variant.id,
          optionLabel: variant.optionLabel,
          decision,
        };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[portal] pricing guidance resolution failed', {
          variantId: variant.id,
          error: error instanceof Error ? error.message : 'unknown',
        });

        return {
          variantId: variant.id,
          optionLabel: variant.optionLabel,
          decision: null,
        };
      }
    }),
  );
}
