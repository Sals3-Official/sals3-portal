import { and, eq } from 'drizzle-orm';
import {
  productOffers,
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  sals3Categories,
} from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';
import { resolveProductPricing } from '@/modules/pricing/resolver';
import type { CategoryMappingConfidence } from '@/modules/pricing/types';

/**
 * Prices a draft's offers, once there is enough known to price them.
 *
 * ## The gap this closes
 *
 * `create-draft.ts` calls the resolver with `categoryCode: null`,
 * `categoryMappingConfidence: 'UNMAPPED'` and `supplierCost: null` — hardcoded
 * to decline. Its comment says why, and it was true when written: *"a CJ
 * product has no mapped Sals3 category, and the resolver refuses to price an
 * unmapped one."*
 *
 * It stopped being true. Products acquired through sourcing do get a Sals3
 * category. Nothing ever priced their offers afterwards — `resolveProductPricing`
 * had exactly four callers, and the one that maps a category
 * (`decide-category.ts`) was not among them. So a sourced product sat at
 * `PRICING_UNRESOLVED` indefinitely, the catalogue showed **Not available**, and
 * the readiness gate refused publication for a reason that had already been
 * fixed.
 *
 * The Product Editor showed a price the whole time, which is what made this
 * hard to see: that number comes from `pricing-guidance.ts`, computed live for
 * display. The offer row is a different fact, and it is the one the catalogue
 * and the publish gate read.
 *
 * ## Why it prices the offer's own market
 *
 * A draft offer already carries the destination `resolveOfferDestinations`
 * chose for it. Re-deriving one here could disagree with the row being written,
 * which is the class of bug that put Australia's rules on Global's row in the
 * store-default save.
 *
 * ## Why a refusal is written, not swallowed
 *
 * A product whose supplier cost has not been observed yet, or whose category
 * still has no markup, genuinely cannot be priced. Recording the resolver's own
 * reason is what lets the catalogue say which of those it is. Silence would put
 * the product back in the state this exists to end.
 */

/** ADR-003 phase 1, the same constant `publishProduct` and `create-draft` pass. */
const SETTLEMENT_CURRENCY = 'USD';

export type PriceDraftOffersResult = {
  /** Offers now carrying a price from the rules. */
  resolved: number;
  /** Offers the rules still refuse, with the reason recorded on each. */
  unresolved: number;
};

type OfferRow = {
  offerId: string;
  marketCode: string;
  variantId: string;
  categoryCode: string | null;
  categoryConfidence: CategoryMappingConfidence;
  supplierCandidateId: string | null;
  supplierVariantId: string | null;
  costMinor: string | number | null;
  costCurrency: string | null;
  observedAt: Date | null;
};

/**
 * Every offer this product owns that is not yet published, with the supplier
 * evidence the resolver needs.
 *
 * Unpublished only. A published offer's price is what a buyer is being charged;
 * moving it is `planReprice`'s job, behind a preview somebody approved. This
 * runs on a category edit, where nobody is looking at a price list.
 */
async function loadDraftOffers(
  executor: Executor,
  sellerAccountId: string,
  productId: string,
): Promise<OfferRow[]> {
  return (await executor
    .select({
      offerId: productOffers.id,
      marketCode: productOffers.marketCode,
      variantId: productVariants.id,
      categoryCode: sals3Categories.code,
      categoryConfidence: products.categoryMappingConfidence,
      supplierCandidateId: providerProductReferences.sourceCandidateId,
      supplierVariantId: providerVariantReferences.externalVariantId,
      costMinor: providerVariantReferences.lastObservedCostMinor,
      costCurrency: providerVariantReferences.lastObservedCostCurrency,
      observedAt: providerVariantReferences.lastObservedAt,
    })
    .from(productOffers)
    .innerJoin(productVariants, eq(productVariants.id, productOffers.variantId))
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
        eq(products.id, productId),
        eq(products.stewardSellerAccountId, sellerAccountId),
        eq(productOffers.sellerAccountId, sellerAccountId),
        eq(productOffers.publishState, 'UNPUBLISHED'),
      ),
    )) as OfferRow[];
}

export type PriceDraftOffersInput = {
  sellerAccountId: string;
  productId: string;
  actorId: string;
};

export default async function priceDraftOffers(
  executor: Executor,
  input: PriceDraftOffersInput,
): Promise<PriceDraftOffersResult> {
  const offers = await loadDraftOffers(
    executor,
    input.sellerAccountId,
    input.productId,
  );

  const result: PriceDraftOffersResult = { resolved: 0, unresolved: 0 };
  const now = new Date();

  // eslint-disable-next-line no-restricted-syntax -- one resolver call and one update per offer, in order.
  for (const offer of offers) {
    /* eslint-disable no-await-in-loop */
    const decision = await resolveProductPricing(executor, {
      sellerAccountId: input.sellerAccountId,
      categoryCode: offer.categoryCode,
      categoryMappingConfidence: offer.categoryConfidence,
      supplierCandidateId: offer.supplierCandidateId,
      supplierVariantId: offer.supplierVariantId,
      supplierCost:
        offer.costMinor === null || offer.costCurrency === null
          ? null
          : {
              amountMinor: Number(offer.costMinor),
              currency: offer.costCurrency,
            },
      supplierCostObservedAt: offer.observedAt?.toISOString() ?? null,
      settlementCurrency: SETTLEMENT_CURRENCY,
      // The row's own destination, never one re-derived here.
      marketCode: offer.marketCode,
    });

    if (decision.outcome === 'PRICING_UNAVAILABLE') {
      await executor
        .update(productOffers)
        .set({
          pricingState: 'UNRESOLVED',
          pricingUnavailableReason: decision.reason,
          updatedAt: now,
          updatedBy: input.actorId,
        })
        .where(eq(productOffers.id, offer.offerId));

      result.unresolved += 1;
    } else {
      await executor
        .update(productOffers)
        .set({
          priceAmountMinor: BigInt(
            decision.roundedSuggestedItemPrice.amountMinor,
          ),
          priceCurrency: decision.roundedSuggestedItemPrice.currency,
          pricingState: 'RESOLVED',
          pricingUnavailableReason: null,
          pricingResolverVersion: decision.resolverVersion,
          pricingDecision: decision,
          updatedAt: now,
          updatedBy: input.actorId,
        })
        .where(eq(productOffers.id, offer.offerId));

      result.resolved += 1;
    }
    /* eslint-enable no-await-in-loop */
  }

  return result;
}
