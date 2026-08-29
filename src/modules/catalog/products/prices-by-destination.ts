import { and, eq } from 'drizzle-orm';
import {
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  sals3Categories,
} from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';
import { listPricingScopeDestinations } from '@/modules/pricing/pricing-scope-destinations';
import { resolveProductPricing } from '@/modules/pricing/resolver';
import type { CategoryMappingConfidence } from '@/modules/pricing/types';
import type { MoneyValue } from '@/lib/seller-center/product-editor/types';

/**
 * What one variant would be priced at in each destination this account sells to.
 *
 * ## Why the editor could not already answer this
 *
 * `pricing-guidance.ts` resolves exactly one market — the seller's active
 * profile destination, or the first capability destination when they have no
 * profile — and the Variants & Pricing table then renders that single number
 * under the unqualified heading `Retail price`. The markups genuinely differ per
 * destination: the same product carried a 200% markup in AU, PH and FJ and 0% in
 * NZ, US and CA on 2026-08-29. So the column was showing one country's price
 * while looking like the price, and nothing on screen said which country.
 *
 * ## Why this is asked for on demand rather than resolved with the page
 *
 * `resolveProductPricing` is about six queries per call. The editor already
 * makes one call per variant — 27 variants is ~162 queries for a page load —
 * and resolving every destination eagerly would multiply that by the number of
 * destinations, roughly 1,100 queries to render a table most sellers will never
 * interrogate. One variant at a time, when somebody actually asks, is six calls.
 *
 * ## Why it re-runs the resolver rather than scaling the number it already has
 *
 * Multiplying the displayed price by the ratio of two markups would be a second
 * implementation of the pricing sum, and this codebase has already paid for one
 * of those: `lib/storefront/fx.ts` carried a hard-coded buffer while the screen
 * a seller edits showed a different one, and the two drifted unnoticed because
 * nothing forced them to agree. The resolver is the only thing that may say what
 * a price is.
 *
 * ## Global is deliberately not a row
 *
 * Global is a rule scope, not a destination. A buyer orders from a country, and
 * the Global rule is what prices the countries with no column of their own —
 * quoting "Global: $20.70" would name a place nobody can order from.
 */

/** ADR-003 phase 1, the same constant `publishProduct` and the reprice pass. */
const SETTLEMENT_CURRENCY = 'USD';

export type DestinationPrice = {
  /** ISO 3166-1 alpha-2. */
  marketCode: string;
  /** The destination's own name, for a reader who does not think in codes. */
  label: string;
  /** `null` when the rules refuse — see `unavailableLabel`. */
  price: MoneyValue | null;
  /** The resolver's own reason, written for a seller who has to fix it. */
  unavailableLabel: string | null;
};

type VariantRow = {
  productId: string;
  categoryCode: string | null;
  categoryConfidence: CategoryMappingConfidence;
  supplierCandidateId: string | null;
  supplierVariantId: string | null;
  costMinor: string | number | null;
  costCurrency: string | null;
  observedAt: Date | null;
};

/**
 * The variant, with the supplier evidence the resolver needs, **scoped to this
 * seller**.
 *
 * The seller filter is part of the `WHERE`, not a check applied to the row
 * afterwards: a variant id is guessable, and a read that fetched first and
 * decided ownership second would already have read another tenant's supplier
 * cost. An id this seller does not steward returns nothing at all, which is
 * indistinguishable from an id that does not exist — the only honest answer to
 * a caller who should not be able to tell the difference.
 *
 * `stewardSellerAccountId` is the same column `pricing-guidance.ts` scopes its
 * own read by; the two must agree about who owns a product or one screen will
 * price something the other refuses to show.
 */
async function loadVariant(
  executor: Executor,
  sellerAccountId: string,
  variantId: string,
): Promise<VariantRow | null> {
  const rows = (await executor
    .select({
      productId: products.id,
      categoryCode: sals3Categories.code,
      categoryConfidence: products.categoryMappingConfidence,
      supplierCandidateId: providerProductReferences.sourceCandidateId,
      supplierVariantId: providerVariantReferences.externalVariantId,
      costMinor: providerVariantReferences.lastObservedCostMinor,
      costCurrency: providerVariantReferences.lastObservedCostCurrency,
      observedAt: providerVariantReferences.lastObservedAt,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(sals3Categories, eq(sals3Categories.id, products.categoryId))
    .leftJoin(
      providerVariantReferences,
      eq(providerVariantReferences.variantId, productVariants.id),
    )
    .leftJoin(
      providerProductReferences,
      eq(
        providerProductReferences.id,
        providerVariantReferences.providerProductReferenceId,
      ),
    )
    .where(
      and(
        eq(productVariants.id, variantId),
        eq(products.stewardSellerAccountId, sellerAccountId),
      ),
    )
    .limit(1)) as VariantRow[];

  return rows[0] ?? null;
}

export type PricesByDestinationInput = {
  sellerAccountId: string;
  variantId: string;
};

/**
 * One row per destination, in the order the pricing screens list them.
 *
 * A refusal is a row, not an omission. "This variant cannot be priced for New
 * Zealand" is exactly what a seller needs to see, and a destination silently
 * missing from the list reads as one that does not exist.
 */
export default async function pricesByDestination(
  executor: Executor,
  input: PricesByDestinationInput,
): Promise<DestinationPrice[] | null> {
  const variant = await loadVariant(
    executor,
    input.sellerAccountId,
    input.variantId,
  );

  if (variant === null) return null;

  const supplierCost =
    variant.costMinor === null || variant.costCurrency === null
      ? null
      : {
          amountMinor: Number(variant.costMinor),
          currency: variant.costCurrency,
        };

  const destinations = listPricingScopeDestinations();

  return Promise.all(
    destinations.map(async (destination): Promise<DestinationPrice> => {
      const decision = await resolveProductPricing(executor, {
        sellerAccountId: input.sellerAccountId,
        categoryCode: variant.categoryCode,
        categoryMappingConfidence: variant.categoryConfidence,
        supplierCandidateId: variant.supplierCandidateId,
        supplierVariantId: variant.supplierVariantId,
        supplierCost,
        supplierCostObservedAt: variant.observedAt?.toISOString() ?? null,
        settlementCurrency: SETTLEMENT_CURRENCY,
        marketCode: destination.code,
      });

      if (decision.outcome === 'PRICING_UNAVAILABLE') {
        return {
          marketCode: destination.code,
          label: destination.label,
          price: null,
          unavailableLabel: decision.reasonLabel,
        };
      }

      return {
        marketCode: destination.code,
        label: destination.label,
        // The rounded price, which is what a buyer would be charged and what
        // `publishProduct` would store — not `suggestedItemPrice`, which is the
        // figure before the rounding rule moved it.
        price: decision.roundedSuggestedItemPrice,
        unavailableLabel: null,
      };
    }),
  );
}
