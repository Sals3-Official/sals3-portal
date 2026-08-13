import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  productOffers,
  productVariants,
  providerVariantReferences,
} from '@/lib/db/schema';

/**
 * The id-keyed reads behind one page of the REAL Product Catalogue: the variant
 * rows a seller sees when expanding a listing, and what pricing actually knows
 * about each product.
 *
 * Both take the page's product ids and answer in ONE statement each, so the
 * cost is fixed at two reads per page rather than two per row. Neither is a
 * tenancy gate: `listCatalogueRowsForSteward` already proved these ids belong
 * to the steward, and re-filtering here would only duplicate that proof - but
 * the offer read still carries the seller filter, because `product_offers` is
 * seller-scoped in its own right and a variant's offers may belong to another
 * tenant.
 */

export type CatalogueVariantRowData = {
  productId: string;
  variantId: string;
  sals3Sku: string;
  status: string;
  weightGrams: number | null;
  /** CJ's own unstructured variant key, verbatim - never parsed into options. */
  sourceOptionLabel: string | null;
  externalVariantId: string | null;
  lastObservedCostMinor: bigint | null;
  lastObservedCostCurrency: string | null;
  lastObservedInventory: number | null;
  lastObservedAt: Date | null;
};

export async function listCatalogueVariants(
  productIds: string[],
): Promise<Map<string, CatalogueVariantRowData[]>> {
  if (productIds.length === 0) return new Map();

  const rows = await getDb()
    .select({
      productId: productVariants.productId,
      variantId: productVariants.id,
      sals3Sku: productVariants.sals3Sku,
      status: productVariants.status,
      weightGrams: productVariants.weightGrams,
      sourceOptionLabel: providerVariantReferences.sourceOptionLabel,
      externalVariantId: providerVariantReferences.externalVariantId,
      lastObservedCostMinor: providerVariantReferences.lastObservedCostMinor,
      lastObservedCostCurrency:
        providerVariantReferences.lastObservedCostCurrency,
      lastObservedInventory: providerVariantReferences.lastObservedInventory,
      lastObservedAt: providerVariantReferences.lastObservedAt,
    })
    .from(productVariants)
    .leftJoin(
      providerVariantReferences,
      eq(providerVariantReferences.variantId, productVariants.id),
    )
    .where(inArray(productVariants.productId, productIds))
    .orderBy(asc(productVariants.sals3Sku));

  const byProduct = new Map<string, CatalogueVariantRowData[]>();

  rows.forEach((row) => {
    const existing = byProduct.get(row.productId);

    if (existing === undefined) byProduct.set(row.productId, [row]);
    else existing.push(row);
  });

  return byProduct;
}

/**
 * What pricing knows about one product, aggregated over its offers.
 *
 * The three outcomes are deliberately distinguishable, because they mean
 * different things to a seller: no offer row at all (nothing has been offered
 * anywhere yet), offers that exist but carry no resolved price (the resolver
 * recorded WHY, and that reason is shown verbatim instead of a placeholder
 * number), and a resolved price.
 */
export type CataloguePricingSummary = {
  offerCount: number;
  resolvedCount: number;
  /** Lowest resolved price across markets, when any resolved. */
  lowestPriceMinor: bigint | null;
  priceCurrency: string | null;
  /** The resolver's own reason string, when nothing resolved. */
  unresolvedReason: string | null;
};

export async function summarizeCataloguePricing(
  sellerAccountId: string,
  productIds: string[],
): Promise<Map<string, CataloguePricingSummary>> {
  if (productIds.length === 0) return new Map();

  const rows = await getDb()
    .select({
      productId: productVariants.productId,
      offerCount: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (
        where ${productOffers.pricingState} = 'RESOLVED'
      )::int`,
      lowestPriceMinor: sql<
        bigint | null
      >`min(${productOffers.priceAmountMinor})`,
      priceCurrency: sql<string | null>`min(${productOffers.priceCurrency})`,
      unresolvedReason: sql<
        string | null
      >`min(${productOffers.pricingUnavailableReason})`,
    })
    .from(productVariants)
    .innerJoin(productOffers, eq(productOffers.variantId, productVariants.id))
    .where(
      and(
        inArray(productVariants.productId, productIds),
        eq(productOffers.sellerAccountId, sellerAccountId),
      ),
    )
    .groupBy(productVariants.productId);

  return new Map(rows.map((row) => [row.productId, row]));
}
