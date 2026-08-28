import { and, eq, inArray } from 'drizzle-orm';
import {
  productOffers,
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  sals3Categories,
} from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';
import { resolveSellerMarketCapabilities } from '@/modules/market-config/capabilities';
import { findActiveProfileForSeller } from '@/modules/market-config/repository';
import {
  markupPercentFromMarginRateScaled,
  parseScaledRate,
} from '@/modules/pricing/money-math';
import { resolveProductPricing } from '@/modules/pricing/resolver';
import type { ResolvedPolicyLayer } from '@/modules/pricing/types';
import { isSellerEnteredPrice } from '@/modules/pricing/seller-entered-price';

/**
 * What the seller's own margin rules say a variant should sell for, worked
 * out while they are looking at the Product Editor.
 *
 * ## The gap this closes
 *
 * The editor's Retail price cell was seeded from `product_offers.price_amount_minor`
 * — the price the variant already carries — and the editor sent every one of
 * those numbers back on publish. `publishProduct` treats any retail price it is
 * given as a price a person typed and **skips the resolver entirely**, so a
 * category margin only ever reached a product's FIRST publication. Every
 * republish after that re-wrote whatever was already in the box, and no margin
 * rule could move it. That is why a seller could set 300% on a department and
 * watch nothing happen to the products in it.
 *
 * So the rules now produce the number the field starts with. The resolver is
 * the same one `publishProduct` and the repricer call, given the same
 * destination and the same supplier cost, so what the seller reads in the cell
 * is what publication will write and what the storefront will show.
 *
 * ## What it does not do
 *
 * It does not overwrite a price a person set. `isSellerEnteredPrice` reads that
 * off the offer's own decision, and a variant carrying one keeps its number and
 * is reported as the seller's — the editor only offers the rule's price as a
 * default for the variants that have not been decided by hand.
 *
 * It resolves and returns; it writes nothing. Publication is still the only
 * thing that puts a price in front of a buyer.
 */

/** ADR-003 phase 1, the same constant `publishProduct` passes. Never inferred here. */
const SETTLEMENT_CURRENCY = 'USD';

export type EditorVariantPricing = {
  variantId: string;
  /** What today's rules say this variant should sell for. `null` when they cannot say. */
  suggestedPriceMinor: number | null;
  suggestedPriceCurrency: string | null;
  /** The resolver's own reason, for a seller who has to fix it. */
  unavailableLabel: string | null;
  /** The category the winning rule sits on — `null` when a store default or an override priced it. */
  sourceCategoryPath: string | null;
  resolvedLayer: ResolvedPolicyLayer | null;
  /** The stored rate, e.g. `0.750000`. */
  targetMarginRate: string | null;
  /**
   * The same rule as markup over cost, e.g. `300`.
   *
   * Shown rather than the margin rate because markup is the unit the bulk
   * sheet speaks and the one a seller sourcing from a supplier holds in their
   * head. Both describe one price; see `money-math.ts`.
   */
  markupPercent: number | null;
  /** True when this variant's live price was typed by a person, not resolved. */
  sellerOverridden: boolean;
  /**
   * The working the price came from, so a screen can show it rather than assert
   * it. Every field is `null` when the rules could not price this variant.
   *
   * `effectiveCost` is the supplier cost after the funding buffer, and it is the
   * number the margin actually divides — which is why `cost × (1 + markup)` does
   * not reproduce the price on its own, and why an explainer that omits this
   * step reads as arithmetic that does not add up.
   */
  effectiveCostMinor: number | null;
  effectiveCostCurrency: string | null;
  /** The seller's funding buffer, in percent, e.g. `1.5`. */
  fundingBufferPercent: number | null;
  /** The stored rule as a margin, in percent, e.g. `25`. */
  marginPercent: number | null;
  /** The price before the rounding rule, when one moved it. `null` when rounding changed nothing. */
  priceBeforeRoundingMinor: number | null;
  /** True when the contribution floor, not the margin, set this price. */
  contributionFloorApplied: boolean;
};

type VariantRow = {
  variantId: string;
  supplierCandidateId: string | null;
  supplierVariantId: string | null;
  costMinor: string | number | null;
  costCurrency: string | null;
  observedAt: Date | null;
  offerDecision: unknown;
  offerResolverVersion: string | null;
};

function unavailable(
  variantId: string,
  label: string,
  sellerOverridden = false,
): EditorVariantPricing {
  return {
    variantId,
    suggestedPriceMinor: null,
    suggestedPriceCurrency: null,
    unavailableLabel: label,
    sourceCategoryPath: null,
    resolvedLayer: null,
    targetMarginRate: null,
    markupPercent: null,
    sellerOverridden,
    effectiveCostMinor: null,
    effectiveCostCurrency: null,
    fundingBufferPercent: null,
    marginPercent: null,
    priceBeforeRoundingMinor: null,
    contributionFloorApplied: false,
  };
}

/** A stored rate as a percentage a person reads, to two decimals. `null` if it cannot be parsed. */
function ratePercentOf(rate: string): number | null {
  try {
    return Math.round(Number(parseScaledRate(rate)) / 100) / 100;
  } catch {
    return null;
  }
}

/**
 * The markup a stored margin rate describes, or `null` if the rate cannot be
 * read. Never throws into a render: a rate this cannot parse is a rate the
 * screen simply does not name.
 */
function markupPercentOf(targetMarginRate: string): number | null {
  try {
    return markupPercentFromMarginRateScaled(parseScaledRate(targetMarginRate));
  } catch {
    return null;
  }
}

/**
 * One resolver call per variant, against the destination this product would
 * publish to.
 *
 * The destination is resolved exactly as `publishProduct` resolves it — the
 * seller's ACTIVE profile, falling back to the platform capability list — so
 * the editor cannot show a price worked out for one country and then publish
 * against another's rule.
 */
export default async function resolveEditorPricingGuidance(
  executor: Executor,
  input: { sellerAccountId: string; productId: string },
): Promise<EditorVariantPricing[]> {
  const productRows = await executor
    .select({
      categoryCode: sals3Categories.code,
      confidence: products.categoryMappingConfidence,
    })
    .from(products)
    .leftJoin(sals3Categories, eq(sals3Categories.id, products.categoryId))
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.stewardSellerAccountId, input.sellerAccountId),
      ),
    )
    .limit(1);

  const product = productRows[0];

  if (product === undefined) return [];

  const variants = (await executor
    .select({
      variantId: productVariants.id,
      supplierCandidateId: providerProductReferences.sourceCandidateId,
      supplierVariantId: providerVariantReferences.externalVariantId,
      costMinor: providerVariantReferences.lastObservedCostMinor,
      costCurrency: providerVariantReferences.lastObservedCostCurrency,
      observedAt: providerVariantReferences.lastObservedAt,
      offerDecision: productOffers.pricingDecision,
      offerResolverVersion: productOffers.pricingResolverVersion,
    })
    .from(productVariants)
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
    .leftJoin(
      productOffers,
      and(
        eq(productOffers.variantId, productVariants.id),
        eq(productOffers.sellerAccountId, input.sellerAccountId),
      ),
    )
    .where(
      and(
        eq(productVariants.productId, input.productId),
        inArray(productVariants.status, ['DRAFT', 'ACTIVE']),
      ),
    )) as VariantRow[];

  if (variants.length === 0) return [];

  const profile = await findActiveProfileForSeller(
    executor,
    input.sellerAccountId,
  );
  const { destinations } = resolveSellerMarketCapabilities();
  const marketCode =
    profile?.destinationCountryCode ?? destinations[0]?.destinationCountryCode;

  const overriddenBy = (row: VariantRow) =>
    isSellerEnteredPrice(row.offerDecision, row.offerResolverVersion);

  if (marketCode === undefined) {
    return variants.map((row) =>
      unavailable(
        row.variantId,
        'No destination is set up, so a price cannot be worked out',
        overriddenBy(row),
      ),
    );
  }

  return Promise.all(
    variants.map(async (row): Promise<EditorVariantPricing> => {
      const sellerOverridden = overriddenBy(row);

      const decision = await resolveProductPricing(executor, {
        sellerAccountId: input.sellerAccountId,
        categoryCode: product.categoryCode,
        categoryMappingConfidence: product.confidence,
        supplierCandidateId: row.supplierCandidateId,
        supplierVariantId: row.supplierVariantId,
        supplierCost:
          row.costMinor === null || row.costCurrency === null
            ? null
            : {
                amountMinor: Number(row.costMinor),
                currency: row.costCurrency,
              },
        supplierCostObservedAt: row.observedAt?.toISOString() ?? null,
        settlementCurrency: SETTLEMENT_CURRENCY,
        marketCode,
      });

      if (decision.outcome === 'PRICING_UNAVAILABLE') {
        return unavailable(
          row.variantId,
          decision.reasonLabel,
          sellerOverridden,
        );
      }

      const rounded = decision.roundedSuggestedItemPrice;
      const beforeRounding = decision.suggestedItemPrice;

      return {
        variantId: row.variantId,
        suggestedPriceMinor: rounded.amountMinor,
        suggestedPriceCurrency: rounded.currency,
        unavailableLabel: null,
        sourceCategoryPath: decision.policySourceCategoryPath,
        resolvedLayer: decision.resolvedLayer,
        targetMarginRate: decision.targetMarginRate,
        markupPercent: markupPercentOf(decision.targetMarginRate),
        sellerOverridden,
        effectiveCostMinor: decision.effectiveProductCost.amountMinor,
        effectiveCostCurrency: decision.effectiveProductCost.currency,
        fundingBufferPercent: ratePercentOf(decision.fundingBufferRate),
        marginPercent: ratePercentOf(decision.targetMarginRate),
        // Only when it actually moved the number — a rounding line that says
        // nothing changed is a line that makes the working harder to follow.
        priceBeforeRoundingMinor:
          beforeRounding.amountMinor === rounded.amountMinor
            ? null
            : beforeRounding.amountMinor,
        contributionFloorApplied: decision.contributionFloorApplied,
      };
    }),
  );
}
