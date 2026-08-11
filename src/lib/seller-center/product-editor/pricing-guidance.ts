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
 *
 * `getDb()` itself is inside this same degrade-don't-crash boundary: it
 * throws synchronously (not just on a failed query) when `DATABASE_URL`
 * is unset at all, which is exactly CI's condition and is exactly as
 * "not the pricing feature's fault" as a missing table — confirmed by a
 * real CI failure where this line sat outside the try/catch and took the
 * whole `/listings/new` page down for every test that visited it.
 */
export default async function resolveFixtureVariantGuidance(
  fixture: ProductEditorFixture,
  sellerAccountId: string,
): Promise<VariantPricingGuidance[]> {
  let db: ReturnType<typeof getDb>;

  try {
    db = getDb();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] pricing guidance database unavailable', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return fixture.variants.map((variant) => ({
      variantId: variant.id,
      optionLabel: variant.optionLabel,
      decision: null,
    }));
  }

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
