import { and, asc, eq, sql } from 'drizzle-orm';
import {
  productOffers,
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  sals3Categories,
} from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';
import { MAX_REPRICE_OFFERS } from './reprice-limits';
import { isSellerEnteredPrice } from './seller-entered-price';
import { resolveProductPricing } from './resolver';
import type {
  CategoryMappingConfidence,
  PricingDecision,
  PricingUnavailableReason,
} from './types';

/**
 * Re-running the price on offers that are already live.
 *
 * ## Why this module exists
 *
 * A price is worked out once, at publish, and then frozen into
 * `product_offers.price_amount_minor` — that freeze is what lets the storefront
 * read one number per card and never call a supplier. The cost of the freeze is
 * that a margin rule saved afterwards changes nothing a buyer sees: before this
 * module, `saveCategoryPolicyAction` revalidated `/market-rules` and touched no
 * offer at all, so a seller who moved a department from 300% to 400% kept
 * selling at the old price until somebody republished each product by hand,
 * with nothing on screen saying so.
 *
 * ## What it deliberately does not do
 *
 * **It never invents the new price.** Every line comes from
 * `resolveProductPricing`, the same function `publishProduct` calls, given the
 * offer's own destination and the product's own category. A second pricing path
 * is how two prices for one product start disagreeing.
 *
 * **It never touches a price a person typed.** An offer published with a
 * seller-entered retail price carries `resolvedLayer: 'SELLER_RETAIL_PRICE'`,
 * and repricing it would silently replace a deliberate decision with a computed
 * one. Those offers are reported and left exactly as they are.
 *
 * **It never guesses past a refusal.** An offer the resolver cannot price —
 * no category mapping, no supplier cost, no policy — keeps the price it already
 * has and is listed as unpriceable. Writing a fabricated number for it would be
 * the flat markup ADR-003 prohibits; refusing the whole run because one product
 * is broken would mean one bad row can freeze the entire catalogue's pricing.
 */

/** ADR-003 phase 1, same constant `publishProduct` passes. Never inferred here. */
const SETTLEMENT_CURRENCY = 'USD';

/**
 * A bound rather than a page: a reprice a seller cannot see the end of is one
 * they cannot check before approving. When more offers exist than this, the run
 * says so out loud (`truncated`) instead of quietly pricing a subset — a silent
 * cap reads as "everything is up to date" when it is not.
 */
export { MAX_REPRICE_OFFERS } from './reprice-limits';

/** How many resolver calls are in flight at once. Bounded so a preview cannot exhaust the connection pool. */
const RESOLVE_CONCURRENCY = 8;

export type RepriceLineStatus =
  /** The rules now say a different number than the offer carries. */
  | 'CHANGED'
  /** The rules still say exactly what the offer already carries. */
  | 'UNCHANGED'
  /** The resolver refused; the live price is left alone. */
  | 'UNPRICEABLE'
  /** A price a person typed. Out of scope by design, never overwritten. */
  | 'MANUAL';

export type RepriceLine = {
  offerId: string;
  offerVersion: number;
  productId: string;
  productTitle: string;
  sku: string;
  marketCode: string;
  currentPriceMinor: number | null;
  currentPriceCurrency: string | null;
  /** `null` for every status except `CHANGED`. */
  newPriceMinor: number | null;
  newPriceCurrency: string | null;
  status: RepriceLineStatus;
  /** The resolver's own reason on `UNPRICEABLE`, so the seller is told what to fix. */
  reason: PricingUnavailableReason | null;
  reasonLabel: string | null;
  /** The full decision to persist. Only ever set on `CHANGED`. */
  decision: PricingDecision | null;
  /**
   * This offer's price was the seller's own and the run is taking it back.
   *
   * Recorded so the audit can say which of two very different things happened:
   * a rule moved a price the rules already owned, or a person's decision was
   * overwritten. Only ever true on a `reclaimSellerPriced` run.
   */
  reclaimed: boolean;
};

export type RepricePlan = {
  lines: RepriceLine[];
  counts: {
    changed: number;
    unchanged: number;
    unpriceable: number;
    manual: number;
  };
  /** True when more published offers exist than `MAX_REPRICE_OFFERS`. */
  truncated: boolean;
  candidateCount: number;
  /**
   * A short digest of exactly the writes this plan would make.
   *
   * The apply step recomputes the plan from scratch and compares digests, so a
   * price that moved between the preview and the click — a rule saved in
   * another tab, a supplier cost that landed — refuses instead of writing
   * numbers nobody approved. It covers the changed set only: an offer that
   * became unpriceable in between changes no write, and an offer that stopped
   * changing simply drops out.
   */
  fingerprint: string;
};

type CandidateRow = {
  offerId: string;
  offerVersion: number;
  marketCode: string;
  currentPriceMinor: bigint | null;
  currentPriceCurrency: string | null;
  pricingDecision: unknown;
  pricingResolverVersion: string | null;
  variantId: string;
  sku: string;
  productId: string;
  productTitle: string;
  categoryCode: string | null;
  categoryConfidence: CategoryMappingConfidence;
  supplierCandidateId: string | null;
  supplierVariantId: string | null;
  costMinor: string | number | null;
  costCurrency: string | null;
  observedAt: Date | null;
};

/**
 * Every published offer this seller owns, with the supplier evidence each one
 * needs to be priced again.
 *
 * Scoped by `publish_state`, not by product state: a published offer is what a
 * buyer can actually see, and that is the set whose price can be wrong. The
 * joins mirror `loadPublishableVariants` in `publishProduct` on purpose — the
 * two must feed the resolver the same facts or they will disagree about the
 * same product.
 */
async function loadCandidates(
  executor: Executor,
  sellerAccountId: string,
): Promise<CandidateRow[]> {
  return executor
    .select({
      offerId: productOffers.id,
      offerVersion: productOffers.version,
      marketCode: productOffers.marketCode,
      currentPriceMinor: productOffers.priceAmountMinor,
      currentPriceCurrency: productOffers.priceCurrency,
      pricingDecision: productOffers.pricingDecision,
      pricingResolverVersion: productOffers.pricingResolverVersion,
      variantId: productVariants.id,
      sku: productVariants.sals3Sku,
      productId: products.id,
      productTitle: products.title,
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
        eq(productOffers.sellerAccountId, sellerAccountId),
        eq(productOffers.publishState, 'PUBLISHED'),
      ),
    )
    .orderBy(asc(products.title), asc(productVariants.sals3Sku))
    .limit(MAX_REPRICE_OFFERS + 1) as Promise<CandidateRow[]>;
}

/** Runs `task` over `items` a few at a time — enough parallelism to keep a preview quick, not enough to flood the pool. */
async function mapBounded<T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let start = 0; start < items.length; start += RESOLVE_CONCURRENCY) {
    const chunk = items.slice(start, start + RESOLVE_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop -- the await IS the bound; the chunk itself runs in parallel.
    const settled = await Promise.all(chunk.map(task));
    results.push(...settled);
  }

  return results;
}

function fingerprintOf(lines: RepriceLine[]): string {
  const changed = lines
    .filter((line) => line.status === 'CHANGED')
    .map((line) => `${line.offerId}:${line.newPriceMinor}`)
    .sort();

  if (changed.length === 0) return 'empty';

  /*
    A checksum, not a hash: this guards against the plan moving under a
    seller's approval, not against anyone forging one. The apply step re-derives
    it from its own fresh read, so an attacker who could choose it would still
    only be choosing which of their own writes to refuse.
  */
  let accumulator = 0;
  const joined = changed.join('|');

  for (let index = 0; index < joined.length; index += 1) {
    accumulator = (accumulator * 31 + joined.charCodeAt(index)) % 2_147_483_647;
  }

  return `${changed.length}-${accumulator.toString(36)}`;
}

/**
 * What repricing this seller's live catalogue would do, without doing any of it.
 *
 * Pure read. The same function backs both the preview a seller approves and the
 * recomputation the apply performs, so the two can never drift into disagreeing
 * about what "affected" means.
 */
export type RepriceOptions = {
  /**
   * Also take back the prices a person typed.
   *
   * Off by default, and the default is the safe one: `writeReprice` replaces
   * `pricing_decision` and `pricing_resolver_version` outright, so a reclaimed
   * offer stops being the seller's for good and **the number it carried is
   * gone** — `product_offers` has no history table and is updated in place.
   *
   * It exists because a repair was otherwise impossible. An earlier editor sent
   * every price back as the seller's own on every save, so offers nobody ever
   * decided are stamped as decisions; on the first account to hit this, 335 of
   * them. Undoing that one product at a time is not a repair anybody finishes.
   */
  reclaimSellerPriced?: boolean;
};

export async function planReprice(
  executor: Executor,
  sellerAccountId: string,
  options: RepriceOptions = {},
): Promise<RepricePlan> {
  const loaded = await loadCandidates(executor, sellerAccountId);
  const truncated = loaded.length > MAX_REPRICE_OFFERS;
  const candidates = truncated ? loaded.slice(0, MAX_REPRICE_OFFERS) : loaded;

  const lines = await mapBounded(
    candidates,
    async (row): Promise<RepriceLine> => {
      const currentPriceMinor =
        row.currentPriceMinor === null ? null : Number(row.currentPriceMinor);

      const base = {
        offerId: row.offerId,
        offerVersion: row.offerVersion,
        productId: row.productId,
        productTitle: row.productTitle,
        sku: row.sku,
        marketCode: row.marketCode,
        currentPriceMinor,
        currentPriceCurrency: row.currentPriceCurrency,
        newPriceMinor: null,
        newPriceCurrency: null,
        reason: null,
        reasonLabel: null,
        decision: null,
        reclaimed: false,
      };

      /*
        An offer with no decision at all predates the stamp and is treated as
        resolved — repricing it is the point of this module, and its own
        resolver run decides whether the number moves.
      */
      const sellerEntered = isSellerEnteredPrice(
        row.pricingDecision,
        row.pricingResolverVersion,
      );

      if (sellerEntered && options.reclaimSellerPriced !== true) {
        return { ...base, status: 'MANUAL' };
      }

      const decision = await resolveProductPricing(executor, {
        sellerAccountId,
        categoryCode: row.categoryCode,
        categoryMappingConfidence: row.categoryConfidence,
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
        // The offer's OWN destination, never the screen's. An offer written for
        // Fiji must be repriced by Fiji's rule or the run would quietly move it
        // onto another country's margin.
        marketCode: row.marketCode,
      });

      if (decision.outcome === 'PRICING_UNAVAILABLE') {
        return {
          ...base,
          status: 'UNPRICEABLE',
          reason: decision.reason,
          reasonLabel: decision.reasonLabel,
        };
      }

      const next = decision.roundedSuggestedItemPrice;
      const sameNumber =
        currentPriceMinor === next.amountMinor &&
        row.currentPriceCurrency === next.currency;

      /*
        A reclaimed offer is written even when the number does not move.

        What changes is ownership, not the figure: `writeReprice` replaces
        `pricing_decision` and `pricing_resolver_version`, and that replacement
        is the whole point — an offer left at the same price but still stamped
        `SELLER_RETAIL_PRICE_V1` would stay exempt from every future rule
        change, which is exactly the state this run exists to end.

        Skipping it as UNCHANGED would have made the repair silently partial for
        every price that already happened to match its rule.
      */
      if (sameNumber && !sellerEntered) {
        return { ...base, status: 'UNCHANGED' };
      }

      return {
        ...base,
        status: 'CHANGED',
        newPriceMinor: next.amountMinor,
        newPriceCurrency: next.currency,
        decision,
        reclaimed: sellerEntered,
      };
    },
  );

  const counts = {
    changed: lines.filter((line) => line.status === 'CHANGED').length,
    unchanged: lines.filter((line) => line.status === 'UNCHANGED').length,
    unpriceable: lines.filter((line) => line.status === 'UNPRICEABLE').length,
    manual: lines.filter((line) => line.status === 'MANUAL').length,
  };

  return {
    lines,
    counts,
    truncated,
    candidateCount: loaded.length,
    fingerprint: fingerprintOf(lines),
  };
}

export type RepriceWriteResult =
  { ok: true; written: number } | { ok: false; reason: 'version_conflict' };

/**
 * Writes the changed prices, and only those.
 *
 * Every update carries the offer version the plan was built from, so an offer
 * republished or repriced in the moment between reading and writing matches
 * zero rows and takes the whole run down with it — the same compare-and-set
 * this codebase uses for a product revision, applied to a price. All or
 * nothing across the write set: a half-applied reprice leaves the catalogue
 * priced by two different decisions with nothing on screen saying which rows
 * took.
 *
 * Call inside a transaction. `writeReprice` does not open one, because the
 * caller has audit events to append in the same unit of work.
 */
export async function writeReprice(
  tx: Executor,
  lines: RepriceLine[],
  actor: { actorId: string; sellerAccountId: string },
): Promise<RepriceWriteResult> {
  const changed = lines.filter((line) => line.status === 'CHANGED');
  const now = new Date();

  // eslint-disable-next-line no-restricted-syntax -- ordered writes: the first conflict must abort before the rest are attempted.
  for (const line of changed) {
    // eslint-disable-next-line no-await-in-loop
    const updated = await tx
      .update(productOffers)
      .set({
        priceAmountMinor: BigInt(line.newPriceMinor as number),
        priceCurrency: line.newPriceCurrency,
        pricingState: 'RESOLVED',
        pricingUnavailableReason: null,
        pricingResolverVersion:
          line.decision !== null ? line.decision.resolverVersion : null,
        pricingDecision: line.decision,
        version: sql`${productOffers.version} + 1`,
        updatedAt: now,
        updatedBy: actor.actorId,
      })
      .where(
        and(
          eq(productOffers.id, line.offerId),
          eq(productOffers.sellerAccountId, actor.sellerAccountId),
          eq(productOffers.version, line.offerVersion),
        ),
      )
      .returning({ id: productOffers.id });

    if (updated.length === 0) return { ok: false, reason: 'version_conflict' };
  }

  return { ok: true, written: changed.length };
}
