import { and, asc, eq, gt } from 'drizzle-orm';
import { productOffers, productVariants, products } from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';
import priceDraftOffers from './price-draft-offers';

/**
 * Prices the drafts that were created before anything could price them.
 *
 * ## Why there is a backlog at all
 *
 * `create-draft.ts` calls the resolver with `UNMAPPED` and a null category —
 * hardcoded to decline, and correct when written. Nothing priced the offers
 * afterwards, because the path that maps a category never called the resolver.
 * `decide-category` does now, so every product mapped from here on prices
 * itself; the ones mapped before that fix stay exactly where they were, showing
 * **Not available** in the catalogue and blocking their own publication.
 *
 * Verified on the owner's account 2026-08-30: re-saving one product's existing
 * category — changing nothing — moved it from `Not available` to `$20.70`. This
 * does that without the clicking.
 *
 * ## Why it only looks at unresolved drafts
 *
 * A published offer's price is what a buyer is being charged, and moving it is
 * `planReprice`'s job behind a preview somebody approved. A draft that already
 * carries a price was priced by something, and re-deriving it here would
 * silently overwrite a seller's own typed number — `product_offers` keeps no
 * history, so that loss would be permanent and invisible.
 *
 * ## Why it is resumable
 *
 * `priceDraftOffers` runs the resolver once per offer, about six queries each.
 * A backlog of any size will outlive a serverless invocation, so each call works
 * until its budget and hands back the product it stopped after. Nothing is lost
 * if a call dies: each product is written on its own, and the next call resumes
 * from the last one that landed.
 */

export type BackfillPosition = {
  /** The last product id covered, or `null` to start at the beginning. */
  afterProductId: string | null;
};

export type BackfillTotals = {
  productsVisited: number;
  offersResolved: number;
  /** Offers the rules still refuse — the reason is recorded on each. */
  offersStillUnresolved: number;
};

export type BackfillResult = {
  ok: true;
  done: boolean;
  position: BackfillPosition;
  totals: BackfillTotals;
};

export const BACKFILL_START: BackfillPosition = { afterProductId: null };

/**
 * The next products holding an unpublished offer the rules have not priced.
 *
 * Ordered by id and read strictly after the position, so a run can be continued
 * without re-reading what it already covered — the same discipline
 * `planReprice`'s cursor uses, and for the same reason: a backfill that returned
 * the same page forever would report success having covered a prefix.
 *
 * `selectDistinct` because a product has one offer per variant per destination,
 * and `priceDraftOffers` already walks all of them for a product.
 */
async function nextProductIds(
  executor: Executor,
  afterProductId: string | null,
  limit: number,
): Promise<Array<{ productId: string; sellerAccountId: string }>> {
  return (await executor
    .selectDistinct({
      productId: products.id,
      sellerAccountId: products.stewardSellerAccountId,
    })
    .from(productOffers)
    .innerJoin(productVariants, eq(productVariants.id, productOffers.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        eq(productOffers.publishState, 'UNPUBLISHED'),
        eq(productOffers.pricingState, 'UNRESOLVED'),
        afterProductId === null ? undefined : gt(products.id, afterProductId),
      ),
    )
    .orderBy(asc(products.id))
    .limit(limit)) as Array<{ productId: string; sellerAccountId: string }>;
}

/** How many products one call reads ahead. Small: each one is several queries. */
const PAGE_SIZE = 25;

export type BackfillOptions = {
  position: BackfillPosition;
  /** Stop starting new products after this many milliseconds. */
  budgetMs: number;
  actorId: string;
  /** Injected so a whole run can be driven in tests without a database. */
  price: typeof priceDraftOffers;
};

export default async function backfillDraftPricing(
  executor: Executor,
  options: BackfillOptions,
  now: () => number = Date.now,
): Promise<BackfillResult> {
  const startedAt = now();
  const totals: BackfillTotals = {
    productsVisited: 0,
    offersResolved: 0,
    offersStillUnresolved: 0,
  };

  let { afterProductId } = options.position;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await nextProductIds(executor, afterProductId, PAGE_SIZE);

    if (batch.length === 0) {
      return { ok: true, done: true, position: { afterProductId }, totals };
    }

    // eslint-disable-next-line no-restricted-syntax -- one product at a time, in order, so the position always means something.
    for (const row of batch) {
      if (now() - startedAt >= options.budgetMs) {
        return { ok: true, done: false, position: { afterProductId }, totals };
      }

      // eslint-disable-next-line no-await-in-loop
      const result = await options.price(executor, {
        sellerAccountId: row.sellerAccountId,
        productId: row.productId,
        actorId: options.actorId,
      });

      totals.productsVisited += 1;
      totals.offersResolved += result.resolved;
      totals.offersStillUnresolved += result.unresolved;

      /*
        Advanced after the write, never before.

        A product that still cannot be priced has its refusal recorded, so it
        drops out of the next batch's `UNRESOLVED` filter only if it resolved —
        which is why the position moves regardless. Without it a product the
        rules genuinely refuse would be re-read on every call, forever.
      */
      afterProductId = row.productId;
    }
  }
}
