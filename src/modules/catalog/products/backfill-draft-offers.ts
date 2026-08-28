import { and, eq, ne, sql } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productOffers, productVariants, products } from '@/lib/db/schema';
import resolveOfferDestinations from '@/modules/market-config/offer-destinations';
import { resolveSellerMarketCapabilities } from '@/modules/market-config/capabilities';
import { insertUnpublishedOffer } from './repository';

/**
 * Gives an offer row to every draft variant that has none.
 *
 * ## What was wrong
 *
 * The screen that creates a `seller_market_profiles` row was removed on
 * 2026-08-20 (owner decision; `market-rules/page.tsx` records it). Until
 * 2026-08-28 `create-draft.ts` required an `ACTIVE` profile before it would
 * create any offer, so its `for (const destination of destinations)` loop ran
 * **zero** times and the product was created with no `product_offers` rows at
 * all.
 *
 * That is not cosmetic. `updateSellerRetailPrices` is UPDATE-only, so Save
 * Draft matched no row, `save-draft.ts` threw `PricePersistenceError`, and the
 * **whole transaction rolled back** — the product name, the specifications and
 * the description with it. Twenty-five drafts were in that state, and each had
 * cost CJ points to source.
 *
 * `resolveOfferDestinations` fixes the write path. It cannot fix a draft that
 * already exists: nothing re-attempts offer creation for a product that has
 * been created. This does.
 *
 * ## Why it shares the resolver rather than deciding for itself
 *
 * The entire defect was two answers to "where may this seller offer". A
 * backfill inventing a third would be the same mistake with a longer fuse — so
 * this calls the same function `create-draft.ts` and `publish.ts` call, and a
 * seller whose every chosen destination has been withdrawn is skipped here for
 * exactly the reason it is refused there: substituting a market they never
 * asked for is worse than leaving the draft as it is.
 *
 * ## What it will not touch
 *
 * - **Published products.** They have offers, and a published offer carries a
 *   resolved price and a publish state this must not invent.
 * - **A variant that already has an offer**, for any market, in any state. The
 *   existence check is per variant, so a partially-offered product is completed
 *   rather than duplicated.
 * - **Prices.** Every row is written `UNRESOLVED` with
 *   `PRICING_NOT_ATTEMPTED`, which is what `create-draft.ts` writes and what the
 *   `product_offers_pricing_state_explained` CHECK requires of a priceless row.
 *   The point is to give Save Draft something to UPDATE, not to guess a price.
 *
 * No supplier call, no CJ points (ADR-017): every input is already in the
 * database or in the capability module.
 *
 * ## Safe to run twice
 *
 * The scan selects variants with no offer, so a second run finds none and
 * reports `0`. `remaining` is counted **after** the writes, from the database
 * rather than from the intent, so a run that achieved nothing cannot report
 * success — the same posture the media-position endpoint takes with
 * `columnExistsAfter`.
 */

/** One run's ceiling. A bounded run that can be repeated beats a long lock. */
const MAX_VARIANTS_PER_RUN = 500;

export type BackfillDraftOffersResult = {
  /** Offer rows created by this run. */
  offersCreated: number;
  /** Distinct draft products that gained at least one offer. */
  productsRepaired: number;
  /**
   * Sellers skipped because every destination they chose has been withdrawn by
   * the platform. Their drafts are left alone deliberately.
   */
  sellersWithNoAuthorizedDestination: number;
  /** Draft variants still without an offer, counted after the writes. */
  remaining: number;
};

/** Draft variants with no offer of their own, oldest product first. */
async function offerlessDraftVariants(db: Database) {
  return db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      sellerAccountId: products.stewardSellerAccountId,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        ne(products.publicationState, 'PUBLISHED'),
        sql`not exists (
          select 1 from ${productOffers} as existing
          where existing.variant_id = ${productVariants.id}
        )`,
      ),
    )
    .limit(MAX_VARIANTS_PER_RUN);
}

async function countRemaining(db: Database): Promise<number> {
  const rows = await db
    .select({ variantId: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        ne(products.publicationState, 'PUBLISHED'),
        sql`not exists (
          select 1 from ${productOffers} as existing
          where existing.variant_id = ${productVariants.id}
        )`,
      ),
    );

  return rows.length;
}

export default async function backfillDraftOffers(
  input: { db?: Database; actorId?: string } = {},
): Promise<BackfillDraftOffersResult> {
  const db = input.db ?? getDb();
  const actorId = input.actorId ?? 'system:backfill-draft-offers';
  const { capabilityVersion } = resolveSellerMarketCapabilities();

  const pending = await offerlessDraftVariants(db);

  // Resolved once per seller, not once per variant: the answer cannot differ
  // between two variants of the same seller, and asking per variant would be
  // one profile read per row.
  const destinationsBySeller = new Map<
    string,
    Awaited<ReturnType<typeof resolveOfferDestinations>>
  >();
  const repairedProducts = new Set<string>();
  const skippedSellers = new Set<string>();
  let offersCreated = 0;

  // eslint-disable-next-line no-restricted-syntax -- sequential: bounded row count, and one insert per row keeps the reuse of `insertUnpublishedOffer` honest.
  for (const row of pending) {
    if (!destinationsBySeller.has(row.sellerAccountId)) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await resolveOfferDestinations(db, row.sellerAccountId);

      destinationsBySeller.set(row.sellerAccountId, resolved);
    }

    const destinations = destinationsBySeller.get(row.sellerAccountId) ?? [];

    if (destinations.length === 0) {
      skippedSellers.add(row.sellerAccountId);
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-restricted-syntax -- see above.
    for (const destination of destinations) {
      // eslint-disable-next-line no-await-in-loop
      await insertUnpublishedOffer(db, {
        sellerAccountId: row.sellerAccountId,
        variantId: row.variantId,
        marketCode: destination.marketCode,
        fulfillmentMode: 'SUPPLIER_DROPSHIP',
        marketProfileId: destination.profileId,
        marketCapabilityVersion: capabilityVersion,
        pricingUnavailableReason: 'PRICING_NOT_ATTEMPTED',
        actorId,
      });

      offersCreated += 1;
    }

    repairedProducts.add(row.productId);
  }

  return {
    offersCreated,
    productsRepaired: repairedProducts.size,
    sellersWithNoAuthorizedDestination: skippedSellers.size,
    remaining: await countRemaining(db),
  };
}

/** Read-only. What a run would do, without doing it. */
export async function countOfferlessDraftVariants(
  db: Database,
): Promise<number> {
  return countRemaining(db);
}
