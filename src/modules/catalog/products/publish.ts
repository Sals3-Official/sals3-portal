import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import {
  offerSupplierBindings,
  productMediaSources,
  productOffers,
  productOptions,
  productRevisions,
  products,
  productVariants,
  providerProductReferences,
  providerVariantReferences,
  sals3Categories,
} from '@/lib/db/schema';
import {
  appendAuditEvent,
  type Executor,
} from '@/modules/catalog/candidates/repository';
import {
  findAuthorizedDestination,
  isAuthorizedSellingCurrency,
  resolveSellerMarketCapabilities,
} from '@/modules/market-config/capabilities';
import { findActiveProfileForSeller } from '@/modules/market-config/repository';
import { resolveProductPricing } from '@/modules/pricing/resolver';
import { isSals3TaxonomyCode } from '@/modules/catalog/taxonomy/v1-reference';
import { deriveOptionSplit } from './option-split';
import {
  projectSupplierMediaForProduct,
  SUPPLIER_MEDIA_RIGHTS,
} from './media-projection';
import { candidateSlugsFromTitle } from './slug';

/**
 * Publishing a product — the one write path that makes a Sals3 catalogue row
 * visible to a buyer.
 *
 * Before this existed, nothing in `src/` ever wrote
 * `publication_state = 'PUBLISHED'`; `contracts.ts` said so in as many words.
 * The storefront now reads published rows and only published rows, so this is
 * what puts anything in the shop.
 *
 * ## It refuses far more often than it succeeds, on purpose
 *
 * Every `PublishRefusal` below is a fact that is missing, not a step that can
 * be skipped. The DB enforces some of them anyway
 * (`products_published_requires_slug`,
 * `product_offers_published_requires_price`) and would raise a constraint
 * error; refusing first turns that into a specific, user-readable reason
 * instead of a 500. Nothing here fabricates a price, a category, an
 * availability, or a rights basis to get past a gate.
 *
 * ## Pricing happens here, not at draft time
 *
 * `create-draft.ts` deliberately calls the resolver with
 * `categoryCode: null` and `supplierCost: null`, so it always records
 * `PRICING_UNAVAILABLE` — honest, because at draft time the product is
 * `UNMAPPED` and no cost has been observed. Publication is the first moment
 * both facts exist, so it is where a price can be resolved and frozen with its
 * policy layers and resolver version (ADR-015 §7).
 *
 * ## One transaction
 *
 * Freezing the revision, pricing the offers, projecting media, reserving the
 * slug, and flipping both publication states happen together. A partial
 * publish is the one state nothing else in the system can interpret: a
 * `PUBLISHED` product with an `UNPUBLISHED` offer renders a card with no price.
 */

/**
 * Whether this product's supplier labels encode option axes that nobody has
 * named yet.
 *
 * ## Conditional on purpose
 *
 * The owner's decision is that mapping is required before publish. Enforcing
 * that unconditionally would brick every product a mapping cannot be *saved* for:
 * `deriveOptionSplit` refuses a single-variant product, ragged token counts and
 * any non-grid label set, and `saveOptionMapping` then refuses
 * `SPLIT_NOT_DERIVABLE`. A blanket gate would leave those permanently
 * unpublishable — including products already live — with no path to fix them.
 *
 * So the requirement attaches to the case where it means something: the labels
 * *do* form a clean grid, so a mapping is both possible and worth having, and
 * none exists. Where no split is derivable there is nothing to name, and the
 * storefront keeps showing each supplier label whole.
 *
 * ## Derived from the same input as the writer
 *
 * The query deliberately mirrors `loadVariantLabels` in `save-option-mapping.ts`
 * — every variant of the product, joined to `provider_variant_references`, with
 * no status filter and no other join. If the gate derived from a different set
 * than the writer, a product could be refused here for being unmapped while the
 * writer refused to map it, which is the deadlock this whole shape avoids.
 *
 * Reads only. No CJ call, no points.
 */
async function optionMappingRequiredButMissing(
  executor: Executor,
  productId: string,
): Promise<boolean> {
  const labels = await executor
    .select({
      variantId: productVariants.id,
      label: providerVariantReferences.sourceOptionLabel,
    })
    .from(productVariants)
    // Unique on `variant_id`, so this matches at most one row per variant and
    // cannot duplicate a label into a false collision.
    .leftJoin(
      providerVariantReferences,
      eq(providerVariantReferences.variantId, productVariants.id),
    )
    .where(eq(productVariants.productId, productId));

  const split = deriveOptionSplit(labels);

  if (split === undefined) return false;

  /**
   * A single-axis product is nameable but does not gate publication (owner
   * decision 2026-08-18).
   *
   * `deriveOptionSplit` accepts a one-token label set — five colours, no
   * delimiter — so those products now get a Variant Matrix in the editor. Gating
   * publication on them as well would have made every colour-only product in the
   * catalogue unpublishable until a seller named its axis, which is a throughput
   * decision, not a correctness one. The case this gate exists for is the
   * concatenated label: an unmapped `Army Green-XL` reaches a buyer as one opaque
   * string, while an unmapped `Black` is already a presentable value.
   */
  if (split.labelWidth < 2) return false;

  const mapped = await executor
    .select({ id: productOptions.id })
    .from(productOptions)
    .where(eq(productOptions.productId, productId))
    .limit(1);

  return mapped.length === 0;
}

export type PublishRefusal =
  | 'NO_ACTIVE_VARIANT'
  /** Replaces `CATEGORY_UNMAPPED` (2026-08-20): a CJ mirror is no longer accepted in its place. */
  | 'SALS3_CATEGORY_REQUIRED'
  | 'OPTIONS_UNMAPPED'
  | 'NO_APPROVED_MEDIA'
  | 'PRICING_UNRESOLVED'
  | 'RETAIL_BELOW_SUPPLIER_COST'
  | 'NO_ACTIVE_MARKET_PROFILE'
  | 'CURRENCY_NOT_AUTHORIZED'
  | 'NO_SUPPLIER_COST'
  | 'NO_ACTIVE_SUPPLIER_BINDING'
  | 'NO_PUBLISHABLE_REVISION'
  | 'SLUG_UNAVAILABLE';

export type PublishProductResult =
  | {
      ok: true;
      slug: string;
      publishedOfferIds: string[];
      availability: 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';
      imagesProjected: number;
    }
  | {
      ok: false;
      reason: 'not_found' | 'version_conflict' | PublishRefusal;
      /** The resolver's own reason when `PRICING_UNRESOLVED`, for the UI. */
      detail?: string;
    };

export type UnpublishProductResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'version_conflict' };

/** ADR-003 phase 1. Passed to the resolver, never assumed inside it. */
const SETTLEMENT_CURRENCY = 'USD';

/**
 * How old observed inventory may be and still support an `AVAILABLE` claim.
 * Matches the freshness window the catalogue read model already applies to
 * supplier evidence: beyond it, the honest answer is `UNKNOWN`, not "in
 * stock".
 */
const INVENTORY_FRESHNESS_MS = 72 * 60 * 60 * 1000;

const AUDIT_ACTIONS = {
  productPublished: 'catalog_product.published',
  offerPublished: 'catalog_product_offer.published',
  productUnpublished: 'catalog_product.unpublished',
} as const;

/**
 * Minor units as a plain decimal for a refusal message a seller has to act on.
 * No locale and no symbol: this string goes into an error detail, not a price
 * label, and `formatMoney`'s display rules (dropping `.00`) would make a
 * below-cost comparison harder to read, not easier.
 */
function formatMinor(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

type PublishableVariant = {
  variantId: string;
  sku: string;
  supplierCandidateId: string | null;
  supplierVariantId: string | null;
  costMinor: number | null;
  costCurrency: string | null;
  inventory: number | null;
  observedAt: Date | null;
  bindingState: string | null;
};

type VariantRetailPrice = {
  variantId: string;
  amountMinor: number;
  currency: string;
};

type SellerRetailPriceDecision = {
  outcome: 'SELLER_RETAIL_PRICE';
  resolvedLayer: 'SELLER_RETAIL_PRICE';
  roundedSuggestedItemPrice: { amountMinor: number; currency: string };
  resolverVersion: 'SELLER_RETAIL_PRICE_V1';
};

type PublishPricingDecision =
  Awaited<ReturnType<typeof resolveProductPricing>> | SellerRetailPriceDecision;

/**
 * The active variants and the supplier facts each one needs to be priced.
 *
 * `provider_variant_references.last_observed_cost_minor` is the cost the
 * resolver is given — never `feed_snapshot.priceUsdCents`, which was verified
 * on 2026-08-13 to be the **lowest** variant price, i.e. a "from" price. Using
 * it would underprice every multi-variant product.
 */
async function loadPublishableVariants(
  executor: Executor,
  productId: string,
): Promise<PublishableVariant[]> {
  const rows = await executor
    .select({
      variantId: productVariants.id,
      sku: productVariants.sals3Sku,
      supplierCandidateId: providerProductReferences.sourceCandidateId,
      supplierVariantId: providerVariantReferences.externalVariantId,
      costMinor: providerVariantReferences.lastObservedCostMinor,
      costCurrency: providerVariantReferences.lastObservedCostCurrency,
      inventory: providerVariantReferences.lastObservedInventory,
      observedAt: providerVariantReferences.lastObservedAt,
      bindingState: offerSupplierBindings.state,
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
      offerSupplierBindings,
      eq(
        offerSupplierBindings.providerVariantReferenceId,
        providerVariantReferences.id,
      ),
    )
    .where(
      and(
        eq(productVariants.productId, productId),
        inArray(productVariants.status, ['DRAFT', 'ACTIVE']),
      ),
    );

  return rows.map((row) => ({
    ...row,
    costMinor: row.costMinor === null ? null : Number(row.costMinor),
  }));
}

/**
 * `AVAILABLE` only on fresh, positive, observed inventory. Anything else is
 * `UNKNOWN` — including stale evidence, because "we saw stock three weeks ago"
 * is not a stock claim. Never derived in the buyer path; frozen here.
 */
function availabilityFromEvidence(
  variant: PublishableVariant,
  now: Date,
): 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE' {
  if (variant.inventory === null || variant.observedAt === null) {
    return 'UNKNOWN';
  }

  if (now.getTime() - variant.observedAt.getTime() > INVENTORY_FRESHNESS_MS) {
    return 'UNKNOWN';
  }

  return variant.inventory > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
}

function strongestAvailability(
  states: ('UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE')[],
): 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE' {
  if (states.includes('AVAILABLE')) return 'AVAILABLE';
  if (states.includes('UNKNOWN')) return 'UNKNOWN';

  return 'UNAVAILABLE';
}

/**
 * Writes the slug **and** `publication_state = 'PUBLISHED'` together, retrying
 * the next candidate slug on a unique violation.
 *
 * The two must be one statement. `products_public_slug_key` is a partial index
 * over `PUBLISHED` rows only, so writing a slug onto an unpublished row can
 * never conflict — a separate "reserve the slug first" step would appear to
 * succeed and then blow up on the publication flip, as a constraint error
 * rather than a refusal.
 *
 * Insert-and-catch, not check-then-write: two concurrent publishes both pass an
 * availability check. Postgres arbitrates instead.
 *
 * A slug already on the row is kept, never regenerated. Because the index is
 * partial, pausing a product frees its slug; re-deriving one on republish could
 * hand the same URL to a different product.
 */
async function publishWithSlug(
  executor: Executor,
  input: {
    productId: string;
    title: string;
    existingSlug: string | null;
    revisionId: string;
    expectedProductVersion: number;
    actorId: string;
    now: Date;
  },
): Promise<string | null> {
  const candidates =
    input.existingSlug !== null
      ? [input.existingSlug]
      : candidateSlugsFromTitle(input.title, input.productId);

  // Ordered attempts: each one depends on the previous attempt's
  // unique-constraint outcome, so they cannot run as an array iteration.
  // eslint-disable-next-line no-restricted-syntax
  for (const slug of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const updated = await executor
        .update(products)
        .set({
          slug,
          publicationState: 'PUBLISHED',
          publishedRevisionId: input.revisionId,
          currentRevisionId: input.revisionId,
          publishedAt: input.now,
          publishedBy: input.actorId,
          version: input.expectedProductVersion + 1,
          updatedAt: input.now,
          updatedBy: input.actorId,
        })
        .where(
          and(
            eq(products.id, input.productId),
            // Re-asserted at the write, not only at the read: the two are
            // separate statements, so a concurrent edit between them must lose
            // here rather than be silently overwritten.
            eq(products.version, input.expectedProductVersion),
          ),
        )
        .returning({ slug: products.slug });

      return updated[0]?.slug ?? null;
    } catch (error) {
      if (uniqueViolationConstraint(error) !== 'products_public_slug_key') {
        throw error;
      }
    }
  }

  return null;
}

export default async function publishProduct(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  variantRetailPrices?: VariantRetailPrice[];
  db?: Database;
}): Promise<PublishProductResult> {
  const db = input.db ?? getDb();
  const now = new Date();
  const retailPricesByVariantId = new Map(
    (input.variantRetailPrices ?? []).map((price) => [price.variantId, price]),
  );

  // Resolved before the transaction: both are pure/config reads, and refusing
  // here means a globally unconfigured market never opens a write transaction.
  const profile = await findActiveProfileForSeller(db, input.sellerAccountId);
  const { capabilityVersion, destinations } = resolveSellerMarketCapabilities();
  const destinationCountryCode =
    profile?.destinationCountryCode ?? destinations[0]?.destinationCountryCode;

  if (destinationCountryCode === undefined) {
    return { ok: false, reason: 'NO_ACTIVE_MARKET_PROFILE' };
  }

  const destination = findAuthorizedDestination(destinationCountryCode);

  if (destination === null) {
    return { ok: false, reason: 'NO_ACTIVE_MARKET_PROFILE' };
  }

  if (!isAuthorizedSellingCurrency(destination, SETTLEMENT_CURRENCY)) {
    return { ok: false, reason: 'CURRENCY_NOT_AUTHORIZED' };
  }

  return db.transaction(async (tx): Promise<PublishProductResult> => {
    // Tenant scope and compare-and-set in one predicate: not found, not
    // yours, and version-moved are answered identically where they can be.
    const productRows = await tx
      .select({
        id: products.id,
        title: products.title,
        slug: products.slug,
        version: products.version,
        categoryId: products.categoryId,
        categoryCode: sals3Categories.code,
        confidence: products.categoryMappingConfidence,
        currentRevisionId: products.currentRevisionId,
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

    if (product === undefined) return { ok: false, reason: 'not_found' };
    if (product.version !== input.expectedProductVersion) {
      return { ok: false, reason: 'version_conflict' };
    }

    const variants = await loadPublishableVariants(tx, input.productId);

    if (variants.length === 0) {
      return { ok: false, reason: 'NO_ACTIVE_VARIANT' };
    }

    const { categoryCode } = product;
    const categoryConfidence = product.confidence;
    const productVersion = input.expectedProductVersion;

    /**
     * Publication requires a real Sals3 Taxonomy v1 category, chosen by a
     * person (owner decision 2026-08-20).
     *
     * This reverses the 2026-08-14 decision that "the CJ category is the
     * Sals3 category", which this branch implemented by calling
     * `ensureProductCjCategory` to mint a `CJ-<uuid>` mirror row and carry
     * on. The mirror keeps the place it earns — a DRAFT default, so a new
     * product has somewhere to sit before anyone has looked at it. What it
     * must not do is reach a live listing: `CJ-976399B4-534B-46F0-B18A-…`
     * is the supplier's filing system, not Sals3's, and once published it
     * becomes the category a buyer browses and the node the pricing chain
     * resolves a margin from.
     *
     * `UNMAPPED`/`AMBIGUOUS` are refused for the reason they always were.
     * What changed is that a mirrored code is refused too, instead of being
     * manufactured on the way past.
     */
    if (
      categoryCode === null ||
      categoryConfidence === 'UNMAPPED' ||
      categoryConfidence === 'AMBIGUOUS' ||
      !isSals3TaxonomyCode(categoryCode)
    ) {
      return { ok: false, reason: 'SALS3_CATEGORY_REQUIRED' };
    }

    if (await optionMappingRequiredButMissing(tx, input.productId)) {
      return { ok: false, reason: 'OPTIONS_UNMAPPED' };
    }

    // A published supplier offer needs a persisted provider variant reference.
    // Older drafts may not have an `offer_supplier_bindings` row yet because
    // they were imported before any seller market profile existed.
    if (!variants.some((variant) => variant.supplierVariantId !== null)) {
      return { ok: false, reason: 'NO_ACTIVE_SUPPLIER_BINDING' };
    }

    const priceable = variants.filter(
      (variant) =>
        variant.supplierVariantId !== null && variant.costMinor !== null,
    );

    if (priceable.length === 0) {
      return { ok: false, reason: 'NO_SUPPLIER_COST' };
    }

    // Media before pricing so a media-less product refuses without having
    // spent the resolver's work.
    const media = await projectSupplierMediaForProduct(tx, {
      productId: input.productId,
      candidateId: priceable[0].supplierCandidateId ?? '',
      actorId: input.actorId,
      rights: SUPPLIER_MEDIA_RIGHTS,
    });
    const approvedMedia = await tx
      .select({ id: productMediaSources.id })
      .from(productMediaSources)
      .where(
        and(
          eq(productMediaSources.productId, input.productId),
          eq(productMediaSources.reviewState, 'APPROVED'),
        ),
      )
      .limit(1);

    if (approvedMedia.length === 0) {
      return { ok: false, reason: 'NO_APPROVED_MEDIA' };
    }

    const publishedOfferIds: string[] = [];
    const availabilityStates: ('UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE')[] = [];

    // One resolver call per variant, each writing its own offer row, in
    // order so a refusal stops before writing the rest.
    // eslint-disable-next-line no-restricted-syntax
    for (const variant of priceable) {
      const retailPrice = retailPricesByVariantId.get(variant.variantId);
      const manualRetailPrice =
        retailPrice !== undefined && retailPrice.amountMinor > 0
          ? retailPrice
          : null;

      let decision: PublishPricingDecision;

      if (manualRetailPrice === null) {
        // eslint-disable-next-line no-await-in-loop
        decision = await resolveProductPricing(tx, {
          sellerAccountId: input.sellerAccountId,
          categoryCode,
          categoryMappingConfidence: categoryConfidence,
          supplierCandidateId: variant.supplierCandidateId,
          supplierVariantId: variant.supplierVariantId,
          supplierCost: {
            amountMinor: variant.costMinor as number,
            currency: variant.costCurrency ?? SETTLEMENT_CURRENCY,
          },
          supplierCostObservedAt: variant.observedAt?.toISOString() ?? null,
          settlementCurrency: SETTLEMENT_CURRENCY,
        });
      } else {
        /**
         * A seller-entered price skips `resolveProductPricing` entirely, so this
         * is the only place a floor can be enforced on it.
         *
         * Before this guard existed the sole validation was `amountMinor > 0`
         * (here and in `publish-actions.ts`), which let a below-cost price
         * publish and be stamped `pricingState: 'RESOLVED'`. That is not
         * hypothetical: on 2026-08-14 the live corduroy jacket carried a
         * `US$4.51` offer against a `US$5.80` supplier cost — a loss of
         * `US$1.29` per unit before freight, and it was the floor price the
         * storefront advertised.
         *
         * The comparison is against the supplier cost only. Cost-plus-margin
         * would be the stronger rule, but it needs a category policy, and a
         * product reaching this branch usually has none — that is why the
         * resolver was skipped. So this refuses the provable loss and leaves the
         * margin question to the resolver.
         */
        const costMinor = variant.costMinor as number;
        const costCurrency = variant.costCurrency ?? SETTLEMENT_CURRENCY;

        if (manualRetailPrice.currency !== costCurrency) {
          // No approved conversion exists on this path, so "is it above cost"
          // cannot be answered. Refusing is the honest outcome; converting at an
          // invented rate is the flat-markup failure ADR-003 prohibits.
          return {
            ok: false,
            reason: 'RETAIL_BELOW_SUPPLIER_COST',
            detail: `Retail price is in ${manualRetailPrice.currency} but supplier cost is in ${costCurrency}, and no approved conversion exists — the price cannot be proved to be above cost.`,
          };
        }

        if (manualRetailPrice.amountMinor < costMinor) {
          return {
            ok: false,
            reason: 'RETAIL_BELOW_SUPPLIER_COST',
            detail: `Retail price ${formatMinor(manualRetailPrice.amountMinor, costCurrency)} is below the supplier cost ${formatMinor(costMinor, costCurrency)} for ${variant.sku}.`,
          };
        }

        decision = {
          outcome: 'SELLER_RETAIL_PRICE',
          resolvedLayer: 'SELLER_RETAIL_PRICE',
          roundedSuggestedItemPrice: {
            amountMinor: manualRetailPrice.amountMinor,
            currency: manualRetailPrice.currency,
          },
          resolverVersion: 'SELLER_RETAIL_PRICE_V1',
        };
      }

      if (decision.outcome === 'PRICING_UNAVAILABLE') {
        // The resolver's own reason, verbatim. It fails closed for a real
        // missing input — a category policy, a funding buffer, a reference
        // rate — and inventing a fallback margin here would be exactly the
        // flat markup ADR-003 prohibits.
        return {
          ok: false,
          reason: 'PRICING_UNRESOLVED',
          detail: decision.reason,
        };
      }

      const availability = availabilityFromEvidence(variant, now);

      availabilityStates.push(availability);

      // eslint-disable-next-line no-await-in-loop
      const [offer] = await tx
        .insert(productOffers)
        .values({
          sellerAccountId: input.sellerAccountId,
          variantId: variant.variantId,
          marketCode: destination.destinationCountryCode,
          fulfillmentMode: 'SUPPLIER_DROPSHIP',
          priceAmountMinor: BigInt(
            decision.roundedSuggestedItemPrice.amountMinor,
          ),
          priceCurrency: decision.roundedSuggestedItemPrice.currency,
          availabilityState: availability,
          publishState: 'PUBLISHED',
          pricingState: 'RESOLVED',
          pricingResolverVersion: decision.resolverVersion,
          pricingDecision: decision,
          marketProfileId: profile?.id ?? null,
          marketCapabilityVersion: capabilityVersion,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        })
        .onConflictDoUpdate({
          target: [
            productOffers.sellerAccountId,
            productOffers.variantId,
            productOffers.marketCode,
            productOffers.fulfillmentMode,
          ],
          set: {
            priceAmountMinor: BigInt(
              decision.roundedSuggestedItemPrice.amountMinor,
            ),
            priceCurrency: decision.roundedSuggestedItemPrice.currency,
            availabilityState: availability,
            publishState: 'PUBLISHED',
            pricingState: 'RESOLVED',
            pricingUnavailableReason: null,
            pricingResolverVersion: decision.resolverVersion,
            pricingDecision: decision,
            marketProfileId: profile?.id ?? null,
            marketCapabilityVersion: capabilityVersion,
            updatedAt: now,
            updatedBy: input.actorId,
          },
        })
        .returning({ id: productOffers.id });

      publishedOfferIds.push(offer.id);

      // eslint-disable-next-line no-await-in-loop
      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: AUDIT_ACTIONS.offerPublished,
        entityType: 'product_offer',
        entityId: offer.id,
        payload: {
          marketCode: destination.destinationCountryCode,
          priceMinor: decision.roundedSuggestedItemPrice.amountMinor,
          priceCurrency: decision.roundedSuggestedItemPrice.currency,
          availability,
          resolverVersion: decision.resolverVersion,
          resolvedLayer: decision.resolvedLayer,
        },
      });
    }

    /**
     * The revision to publish: the open DRAFT if there is one, otherwise the
     * already-frozen APPROVED revision of a product being republished.
     * Ordered explicitly — `DRAFT` before `APPROVED` — because picking
     * whichever row the planner returned would sometimes publish stale copy
     * while an edited draft sat unpublished.
     */
    const revisionRows = await tx
      .select({
        id: productRevisions.id,
        workflowState: productRevisions.workflowState,
        contentDocument: productRevisions.contentDocument,
      })
      .from(productRevisions)
      .where(
        and(
          eq(productRevisions.productId, input.productId),
          inArray(productRevisions.workflowState, ['DRAFT', 'APPROVED']),
        ),
      )
      .orderBy(
        // 'APPROVED' sorts before 'DRAFT' alphabetically, so order on the
        // state we actually prefer rather than on the enum's text.
        sql`case when ${productRevisions.workflowState} = 'DRAFT' then 0 else 1 end`,
        desc(productRevisions.revisionNumber),
      )
      .limit(1);
    const revision = revisionRows[0];

    if (revision === undefined) {
      return { ok: false, reason: 'NO_PUBLISHABLE_REVISION' };
    }

    // Freeze only on the way out of DRAFT. Re-freezing an already-APPROVED
    // revision would move `frozen_at` and overwrite the snapshot that is
    // supposed to be immutable after submission (spec §16).
    if (revision.workflowState === 'DRAFT') {
      await tx
        .update(productRevisions)
        .set({
          workflowState: 'APPROVED',
          contentSnapshot: revision.contentDocument,
          frozenAt: now,
          // AUTO is the accurate mode: no human reviewed this copy, the
          // seller published it. `MANUAL_EXCEPTION` would claim a review
          // that did not happen.
          approvalMode: 'AUTO',
          approvalPolicyVersion: capabilityVersion,
          approvedAt: now,
          approvedBy: input.actorId,
          updatedAt: now,
          updatedBy: input.actorId,
        })
        .where(eq(productRevisions.id, revision.id));
    }

    const availability = strongestAvailability(availabilityStates);
    const slug = await publishWithSlug(tx, {
      productId: input.productId,
      title: product.title,
      existingSlug: product.slug,
      revisionId: revision.id,
      expectedProductVersion: productVersion,
      actorId: input.actorId,
      now,
    });

    if (slug === null) return { ok: false, reason: 'SLUG_UNAVAILABLE' };

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: AUDIT_ACTIONS.productPublished,
      entityType: 'product',
      entityId: input.productId,
      payload: {
        slug,
        marketCode: destination.destinationCountryCode,
        offerCount: publishedOfferIds.length,
        availability,
        imagesProjected: media.inserted,
        mediaSource: media.source,
        rightsBasis: SUPPLIER_MEDIA_RIGHTS.rightsBasis,
      },
    });

    return {
      ok: true,
      slug,
      publishedOfferIds,
      availability,
      imagesProjected: media.inserted,
    };
  });
}

/**
 * Pauses a published product.
 *
 * A published product with no reverse gear is an operational trap: the only
 * remedy for a wrong price or a delisted supplier item would be a database
 * edit. `PAUSED` rather than `UNPUBLISHED` because the product has been live —
 * the state should say so — and the slug deliberately stays on the row, so a
 * later republish keeps the same public URL.
 */
export async function unpublishProduct(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  db?: Database;
}): Promise<UnpublishProductResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx): Promise<UnpublishProductResult> => {
    const updated = await tx
      .update(products)
      .set({
        publicationState: 'PAUSED',
        version: input.expectedProductVersion + 1,
        updatedAt: now,
        updatedBy: input.actorId,
      })
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.stewardSellerAccountId, input.sellerAccountId),
          eq(products.version, input.expectedProductVersion),
          eq(products.publicationState, 'PUBLISHED'),
        ),
      )
      .returning({ id: products.id });

    if (updated.length === 0) {
      return { ok: false, reason: 'version_conflict' };
    }

    const variantIds = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, input.productId));

    if (variantIds.length > 0) {
      await tx
        .update(productOffers)
        .set({
          publishState: 'PAUSED',
          updatedAt: now,
          updatedBy: input.actorId,
        })
        .where(
          and(
            inArray(
              productOffers.variantId,
              variantIds.map((row) => row.id),
            ),
            eq(productOffers.sellerAccountId, input.sellerAccountId),
            eq(productOffers.publishState, 'PUBLISHED'),
          ),
        );
    }

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: AUDIT_ACTIONS.productUnpublished,
      entityType: 'product',
      entityId: input.productId,
      payload: { pausedOfferVariantCount: variantIds.length },
    });

    return { ok: true };
  });
}
