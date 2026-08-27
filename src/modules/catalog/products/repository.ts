import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import {
  offerSupplierBindings,
  productOffers,
  productRevisions,
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  supplierCandidates,
  supplierConnections,
  supplierProviders,
  type OfferFulfillmentMode,
  type OfferSupplierBindingRow,
  type ProductOfferRow,
  type ProductRevisionRow,
  type ProductRow,
  type ProductVariantRow,
  type ProviderProductReferenceRow,
  type ProviderVariantReferenceRow,
  type SupplierConnectionRow,
} from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';

import type { DescriptionDocument } from './description-document';

/**
 * Data access for the canonical catalog.
 *
 * Three rules hold throughout, and each one is load-bearing rather than
 * stylistic:
 *
 * 1. **Ownership is in the statement, never applied afterwards.** Every
 *    editorial read and write folds `steward_seller_account_id` (or, for an
 *    offer, `seller_account_id`) into the same `WHERE` clause as the id. A
 *    "fetch, then compare in JavaScript" shape is the classic IDOR bug, and
 *    it also leaks existence through timing and error differences.
 * 2. **Mutations are compare-and-set.** They name the state and version the
 *    caller believes it is acting on, so a stale editor, a replayed submit,
 *    and another tenant's id all match zero rows and return `null` — one
 *    indistinguishable answer.
 * 3. **No function opens its own transaction.** The caller passes an
 *    `Executor` so authorization, every write, and the audit event commit
 *    together or not at all.
 *
 * The get-or-create helpers below read first and insert second. That is a
 * race under concurrency, and it is handled deliberately at the layer above:
 * `create-draft.ts` retries the whole transaction once when a unique index
 * rejects the insert, and the second pass finds the row the winner created.
 * The index — not the read — is the arbiter, which is the only version that
 * holds when two requests arrive at the same instant.
 */

// --- Candidate source context -------------------------------------------------

export type CandidateSourceContext = {
  candidateId: string;
  externalProductId: string;
  supplierConnectionId: string;
  connectionStatus: SupplierConnectionRow['status'];
  supplierProviderId: string;
  supplierProviderCode: string;
  /**
   * The provider's own category id, as discovery recorded it. Null on a row
   * written before that column existed. It is the only input the taxonomy
   * resolver accepts, and it is deliberately the id rather than the category
   * *name*: a name is a string CJ can reword, while an approved mapping is
   * keyed to this value (`scripts/approve-cj-category-mapping.mts`).
   */
  providerCategoryId: string | null;
};

/**
 * Resolves everything the draft flow needs about a candidate in one
 * tenant-scoped statement: the candidate, the connection that owns it, its
 * current health, and the provider behind it.
 *
 * The seller condition sits on `supplier_connections.seller_account_id`
 * rather than on the candidate's legacy `intended_seller_id` display column,
 * matching `candidateBelongsToSeller` — the connection is the source of truth
 * for tenancy under ADR-006/008.
 */
export async function findCandidateSourceForSeller(
  executor: Executor,
  candidateId: string,
  sellerAccountId: string,
): Promise<CandidateSourceContext | null> {
  const rows = await executor
    .select({
      candidateId: supplierCandidates.id,
      externalProductId: supplierCandidates.externalProductId,
      supplierConnectionId: supplierCandidates.supplierConnectionId,
      connectionStatus: supplierConnections.status,
      supplierProviderId: supplierProviders.id,
      supplierProviderCode: supplierProviders.code,
      providerCategoryId: supplierCandidates.providerCategoryId,
    })
    .from(supplierCandidates)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .innerJoin(
      supplierProviders,
      eq(supplierProviders.id, supplierConnections.providerId),
    )
    .where(
      and(
        eq(supplierCandidates.id, candidateId),
        eq(supplierConnections.sellerAccountId, sellerAccountId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

// --- Provider product reference and canonical product -------------------------

export async function findProviderProductReference(
  executor: Executor,
  supplierProviderId: string,
  externalProductId: string,
): Promise<ProviderProductReferenceRow | null> {
  const rows = await executor
    .select()
    .from(providerProductReferences)
    .where(
      and(
        eq(providerProductReferences.supplierProviderId, supplierProviderId),
        eq(providerProductReferences.externalProductId, externalProductId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Provenance only: whether this candidate was ever drafted into a Sals3
 * product, and against which snapshot checksum.
 *
 * `provider_product_references` is global rather than connection-scoped (see
 * that table's own comment), so the caller must already have proven the
 * candidate belongs to the reading seller. No product id is offered for
 * navigation from here for the same reason.
 */
export async function listProviderReferencesForSourceCandidate(
  executor: Executor,
  sourceCandidateId: string,
): Promise<ProviderProductReferenceRow[]> {
  return executor
    .select()
    .from(providerProductReferences)
    .where(eq(providerProductReferences.sourceCandidateId, sourceCandidateId));
}

export async function findProductById(
  executor: Executor,
  productId: string,
): Promise<ProductRow | null> {
  const rows = await executor
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  return rows[0] ?? null;
}

/** Editorial read. Returns `null` for a product this account does not steward. */
export async function findProductForSteward(
  executor: Executor,
  productId: string,
  stewardSellerAccountId: string,
): Promise<ProductRow | null> {
  const rows = await executor
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.stewardSellerAccountId, stewardSellerAccountId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function insertProduct(
  executor: Executor,
  input: {
    stewardSellerAccountId: string;
    title: string;
    actorId: string;
  },
): Promise<ProductRow> {
  const [row] = await executor
    .insert(products)
    .values({
      stewardSellerAccountId: input.stewardSellerAccountId,
      title: input.title,
      // Absent, not guessed. A slug is minted at publication (spec §4.3), no
      // Sals3 category is mapped for a CJ product (spec §26), and a supplier
      // brand-like phrase is not brand evidence (spec §7).
      slug: null,
      categoryId: null,
      categoryMappingConfidence: 'UNMAPPED',
      brandMode: 'UNBRANDED',
      brandName: null,
      publicationState: 'UNPUBLISHED',
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .returning();

  return row;
}

export async function insertProviderProductReference(
  executor: Executor,
  input: {
    productId: string;
    supplierProviderId: string;
    externalProductId: string;
    sourceCandidateId: string;
    snapshotChecksum: string | null;
    lastObservedAt: Date | null;
    actorId: string;
  },
): Promise<ProviderProductReferenceRow> {
  const [row] = await executor
    .insert(providerProductReferences)
    .values({
      productId: input.productId,
      supplierProviderId: input.supplierProviderId,
      externalProductId: input.externalProductId,
      sourceCandidateId: input.sourceCandidateId,
      snapshotChecksum: input.snapshotChecksum,
      // The evidence capture time, never `now()`. Claiming this instant would
      // assert a freshness no code in this path verified.
      lastObservedAt: input.lastObservedAt,
      // `UNKNOWN`/`STALE`: built from a stored snapshot, not a live read.
      sourceStatus: 'UNKNOWN',
      syncState: 'STALE',
      createdBy: input.actorId,
    })
    .returning();

  return row;
}

// --- Revisions ----------------------------------------------------------------

export async function findOpenDraftRevision(
  executor: Executor,
  productId: string,
): Promise<ProductRevisionRow | null> {
  const rows = await executor
    .select()
    .from(productRevisions)
    .where(
      and(
        eq(productRevisions.productId, productId),
        eq(productRevisions.workflowState, 'DRAFT'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * One revision of one product, by id.
 *
 * The `productId` term is not decoration: it is what stops a revision id
 * belonging to another seller's product from being read through a caller that
 * has already checked stewardship of a *different* product. Same rule as
 * every other statement here — ownership travels in the `WHERE` clause.
 */
export async function findRevisionOfProduct(
  executor: Executor,
  input: { revisionId: string; productId: string },
): Promise<ProductRevisionRow | null> {
  const rows = await executor
    .select()
    .from(productRevisions)
    .where(
      and(
        eq(productRevisions.id, input.revisionId),
        eq(productRevisions.productId, input.productId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function findHighestRevisionNumber(
  executor: Executor,
  productId: string,
): Promise<number> {
  const rows = await executor
    .select({ revisionNumber: productRevisions.revisionNumber })
    .from(productRevisions)
    .where(eq(productRevisions.productId, productId))
    .orderBy(asc(productRevisions.revisionNumber));

  return rows.reduce(
    (highest, row) => Math.max(highest, row.revisionNumber),
    0,
  );
}

/**
 * Creates the next `DRAFT` revision for a product.
 *
 * This is also the fork-on-edit path: editing a published product never
 * rewrites the public revision (spec §6.2), it creates the next draft here
 * (`open-draft-for-edit.ts`). The partial unique index
 * `product_revisions_open_draft_key` is what makes that safe — a second
 * concurrent fork collides instead of producing two rival drafts of the same
 * product.
 *
 * That collision is answered with `ON CONFLICT DO NOTHING` and a `null`
 * return rather than a raised error, because the alternative is worse than
 * verbose: a unique violation aborts the whole surrounding transaction in
 * Postgres, so the loser could not even record why it lost. `null` means
 * "another writer already holds this product's open draft (or its revision
 * number)" and leaves the transaction usable, which is what lets the caller
 * refuse cleanly instead of crashing or riding along on the winner's draft.
 */
export async function insertDraftRevision(
  executor: Executor,
  input: {
    productId: string;
    revisionNumber: number;
    expectedProductVersion: number;
    contentDocument: DescriptionDocument;
    contentChecksum: string;
    actorId: string;
  },
): Promise<ProductRevisionRow | null> {
  const [row] = await executor
    .insert(productRevisions)
    .values({
      productId: input.productId,
      revisionNumber: input.revisionNumber,
      workflowState: 'DRAFT',
      contentDocument: input.contentDocument,
      contentChecksum: input.contentChecksum,
      // A draft is mutable by definition, so it carries no frozen snapshot.
      // The check constraint only demands one once the revision settles.
      contentSnapshot: null,
      frozenAt: null,
      expectedProductVersion: input.expectedProductVersion,
      // ADR-011 §2's default for a newly imported supplier candidate.
      mediaPreference: 'SELLER_FIRST',
      // No approval has happened. Recording one would be the fabricated
      // auto-approval spec §6.2 explicitly rules out.
      approvalMode: null,
      approvalPolicyVersion: null,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onConflictDoNothing()
    .returning();

  return row ?? null;
}

export async function setCurrentRevision(
  executor: Executor,
  input: { productId: string; revisionId: string; actorId: string },
): Promise<void> {
  await executor
    .update(products)
    .set({
      currentRevisionId: input.revisionId,
      updatedAt: new Date(),
      updatedBy: input.actorId,
    })
    .where(eq(products.id, input.productId));
}

/**
 * Retires the revisions a newly published one replaces.
 *
 * `APPROVED` is meant to name the copy a product is currently published from.
 * Leaving the previous one in that state after a newer revision goes live
 * would leave two rows making the same claim, and `products` — which already
 * records the live one in `published_revision_id` — would be the only way to
 * tell which is true. `SUPERSEDED` is already in the enum for exactly this.
 *
 * Safe against the frozen-when-settled check constraint: every row this
 * touches is `APPROVED`, so it already carries `content_snapshot` and
 * `frozen_at`, and moving it to `SUPERSEDED` keeps that constraint satisfied.
 * Nothing is unfrozen and no snapshot is rewritten — an accepted order's
 * frozen content stays byte-identical.
 */
export async function markApprovedRevisionsSuperseded(
  executor: Executor,
  input: {
    productId: string;
    exceptRevisionId: string;
    actorId: string;
    now: Date;
  },
): Promise<string[]> {
  const rows = await executor
    .update(productRevisions)
    .set({
      workflowState: 'SUPERSEDED',
      updatedAt: input.now,
      updatedBy: input.actorId,
    })
    .where(
      and(
        eq(productRevisions.productId, input.productId),
        eq(productRevisions.workflowState, 'APPROVED'),
        ne(productRevisions.id, input.exceptRevisionId),
      ),
    )
    .returning({ id: productRevisions.id });

  return rows.map((row) => row.id);
}

/**
 * Saves editorial content onto an open draft.
 *
 * Four conditions travel together in the `WHERE` clause, and dropping any one
 * of them reintroduces a real defect: the revision id (which row), the
 * product id (that the caller's product actually owns it), `DRAFT` (that a
 * submitted or approved revision can never be rewritten in place — spec §16's
 * immutability rule), and the expected version (that a stale editor loses the
 * race). `null` means at least one failed; the caller cannot tell which,
 * which is deliberate.
 *
 * Steward ownership is checked by the caller before this runs and is not
 * re-encoded here, because `product_revisions` has no seller column — the
 * product does.
 */
export async function saveDraftRevisionContent(
  executor: Executor,
  input: {
    revisionId: string;
    productId: string;
    expectedVersion: number;
    contentDocument: DescriptionDocument;
    contentChecksum: string;
    actorId: string;
  },
): Promise<ProductRevisionRow | null> {
  const [row] = await executor
    .update(productRevisions)
    .set({
      contentDocument: input.contentDocument,
      contentChecksum: input.contentChecksum,
      version: input.expectedVersion + 1,
      updatedAt: new Date(),
      updatedBy: input.actorId,
    })
    .where(
      and(
        eq(productRevisions.id, input.revisionId),
        eq(productRevisions.productId, input.productId),
        eq(productRevisions.workflowState, 'DRAFT'),
        eq(productRevisions.version, input.expectedVersion),
      ),
    )
    .returning();

  return row ?? null;
}

/** Editorial title lives on the product; kept in step with the draft save. */
export async function updateProductEditorialForSteward(
  executor: Executor,
  input: {
    productId: string;
    stewardSellerAccountId: string;
    title: string;
    sals3CategoryL1: string | null;
    actorId: string;
  },
): Promise<ProductRow | null> {
  const [row] = await executor
    .update(products)
    .set({
      title: input.title,
      sals3CategoryL1: input.sals3CategoryL1,
      updatedAt: new Date(),
      updatedBy: input.actorId,
    })
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.stewardSellerAccountId, input.stewardSellerAccountId),
      ),
    )
    .returning();

  return row ?? null;
}

// --- Variants and provider variant references ---------------------------------

export async function findProviderVariantReference(
  executor: Executor,
  providerProductReferenceId: string,
  externalVariantId: string,
): Promise<ProviderVariantReferenceRow | null> {
  const rows = await executor
    .select()
    .from(providerVariantReferences)
    .where(
      and(
        eq(
          providerVariantReferences.providerProductReferenceId,
          providerProductReferenceId,
        ),
        eq(providerVariantReferences.externalVariantId, externalVariantId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function listVariantsForProduct(
  executor: Executor,
  productId: string,
): Promise<ProductVariantRow[]> {
  return executor
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.sals3Sku));
}

/**
 * The four supplier measurements are `integer` columns, and CJ reports them as
 * plain numbers with no guarantee of being whole. A fractional value would make
 * the insert throw and take the whole draft creation down with it, so it is
 * rounded here rather than refused: a packed box measured to the nearest
 * millimetre is still an honest supplier fact, and no observed CJ payload has
 * ever carried a fraction.
 */
function roundedMeasurement(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

export async function insertDraftVariant(
  executor: Executor,
  input: {
    productId: string;
    sals3Sku: string;
    weightGrams: number | null;
    /**
     * Packed box dimensions in millimetres, as CJ reports them.
     *
     * These used to be hard-coded `null` here while `weightGrams` was passed
     * through, which is why a published product showed a supplier weight and no
     * dimensions. Two things read them, and both were silently degraded: the
     * storefront's Supplier details block, and `freight-quotes.ts`, which
     * cannot compute a volumetric weight without all three.
     */
    lengthMillimeters: number | null;
    widthMillimeters: number | null;
    heightMillimeters: number | null;
    actorId: string;
  },
): Promise<ProductVariantRow> {
  const [row] = await executor
    .insert(productVariants)
    .values({
      productId: input.productId,
      sals3Sku: input.sals3Sku,
      // `DRAFT` with no combination key. The check constraint would reject
      // `ACTIVE` here anyway, which is the structural version of "a variant
      // is not sellable just because a supplier listed it".
      status: 'DRAFT',
      optionCombinationKey: null,
      // ADR-013 §7: never invent a GTIN, MPN, or identifier claim.
      gtins: null,
      mpn: null,
      identifierExists: true,
      weightGrams: roundedMeasurement(input.weightGrams),
      lengthMillimeters: roundedMeasurement(input.lengthMillimeters),
      widthMillimeters: roundedMeasurement(input.widthMillimeters),
      heightMillimeters: roundedMeasurement(input.heightMillimeters),
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .returning();

  return row;
}

export async function insertProviderVariantReference(
  executor: Executor,
  input: {
    providerProductReferenceId: string;
    variantId: string;
    externalVariantId: string;
    externalSku: string | null;
    sourceOptionLabel: string | null;
    lastObservedCostMinor: bigint | null;
    lastObservedCostCurrency: string | null;
    lastObservedInventory: number | null;
    lastObservedAt: Date | null;
    actorId: string;
  },
): Promise<ProviderVariantReferenceRow> {
  const [row] = await executor
    .insert(providerVariantReferences)
    .values({
      providerProductReferenceId: input.providerProductReferenceId,
      variantId: input.variantId,
      externalVariantId: input.externalVariantId,
      externalSku: input.externalSku,
      sourceOptionLabel: input.sourceOptionLabel,
      sourceStatus: 'UNKNOWN',
      lastObservedCostMinor: input.lastObservedCostMinor,
      lastObservedCostCurrency: input.lastObservedCostCurrency,
      lastObservedInventory: input.lastObservedInventory,
      lastObservedAt: input.lastObservedAt,
      createdBy: input.actorId,
    })
    .returning();

  return row;
}

// --- Offers and bindings ------------------------------------------------------

export async function findOffer(
  executor: Executor,
  input: {
    sellerAccountId: string;
    variantId: string;
    marketCode: string;
    fulfillmentMode: OfferFulfillmentMode;
  },
): Promise<ProductOfferRow | null> {
  const rows = await executor
    .select()
    .from(productOffers)
    .where(
      and(
        eq(productOffers.sellerAccountId, input.sellerAccountId),
        eq(productOffers.variantId, input.variantId),
        eq(productOffers.marketCode, input.marketCode),
        eq(productOffers.fulfillmentMode, input.fulfillmentMode),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function insertUnpublishedOffer(
  executor: Executor,
  input: {
    sellerAccountId: string;
    variantId: string;
    marketCode: string;
    fulfillmentMode: OfferFulfillmentMode;
    marketProfileId: string;
    marketCapabilityVersion: string;
    pricingUnavailableReason: string;
    actorId: string;
  },
): Promise<ProductOfferRow> {
  const [row] = await executor
    .insert(productOffers)
    .values({
      sellerAccountId: input.sellerAccountId,
      variantId: input.variantId,
      marketCode: input.marketCode,
      fulfillmentMode: input.fulfillmentMode,
      // No price, and the resolver's own reason recorded instead of a
      // placeholder number. The `product_offers_pricing_state_explained`
      // check makes "unresolved with no reason" impossible to store.
      priceAmountMinor: null,
      priceCurrency: null,
      compareAtAmountMinor: null,
      compareAtCurrency: null,
      comparisonEvidenceId: null,
      availabilityState: 'UNKNOWN',
      publishState: 'UNPUBLISHED',
      pricingState: 'UNRESOLVED',
      pricingUnavailableReason: input.pricingUnavailableReason,
      pricingResolverVersion: null,
      pricingDecision: null,
      marketProfileId: input.marketProfileId,
      marketCapabilityVersion: input.marketCapabilityVersion,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .returning();

  return row;
}

export async function updateSellerRetailPrices(
  executor: Executor,
  input: {
    productId: string;
    sellerAccountId: string;
    prices: Array<{
      variantId: string;
      amountMinor: number;
      currency: string;
    }>;
    actorId: string;
  },
): Promise<{ updatedOfferCount: number; missedVariantIds: string[] }> {
  if (input.prices.length === 0)
    return { updatedOfferCount: 0, missedVariantIds: [] };

  const requestedVariantIds = input.prices.map((price) => price.variantId);
  const variantRows = await executor
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.productId, input.productId),
        inArray(productVariants.id, requestedVariantIds),
      ),
    );
  const productVariantIds = new Set(variantRows.map((row) => row.id));
  const missedVariantIds: string[] = [];
  const updatedOfferCount = await input.prices.reduce<Promise<number>>(
    async (totalPromise, price) => {
      const total = await totalPromise;

      if (!productVariantIds.has(price.variantId)) {
        missedVariantIds.push(price.variantId);

        return total;
      }

      const rows = await executor
        .update(productOffers)
        .set({
          priceAmountMinor: BigInt(price.amountMinor),
          priceCurrency: price.currency,
          pricingState: 'RESOLVED',
          pricingUnavailableReason: null,
          pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
          pricingDecision: {
            source: 'SELLER_RETAIL_PRICE',
            amountMinor: price.amountMinor,
            currency: price.currency,
          },
          updatedAt: new Date(),
          updatedBy: input.actorId,
        })
        .where(
          and(
            eq(productOffers.sellerAccountId, input.sellerAccountId),
            eq(productOffers.variantId, price.variantId),
          ),
        )
        .returning({ id: productOffers.id });

      if (rows.length === 0) missedVariantIds.push(price.variantId);

      return total + rows.length;
    },
    Promise.resolve(0),
  );

  return { updatedOfferCount, missedVariantIds };
}

export async function findBinding(
  executor: Executor,
  input: {
    offerId: string;
    supplierConnectionId: string;
    providerVariantReferenceId: string;
  },
): Promise<OfferSupplierBindingRow | null> {
  const rows = await executor
    .select()
    .from(offerSupplierBindings)
    .where(
      and(
        eq(offerSupplierBindings.offerId, input.offerId),
        eq(
          offerSupplierBindings.supplierConnectionId,
          input.supplierConnectionId,
        ),
        eq(
          offerSupplierBindings.providerVariantReferenceId,
          input.providerVariantReferenceId,
        ),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function insertUnverifiedBinding(
  executor: Executor,
  input: {
    offerId: string;
    supplierConnectionId: string;
    providerVariantReferenceId: string;
    actorId: string;
  },
): Promise<OfferSupplierBindingRow> {
  const [row] = await executor
    .insert(offerSupplierBindings)
    .values({
      offerId: input.offerId,
      supplierConnectionId: input.supplierConnectionId,
      providerVariantReferenceId: input.providerVariantReferenceId,
      // `UNVERIFIED`, not `ACTIVE`. Nothing in this path contacted the
      // supplier, so no binding may claim it was proven fulfillable.
      state: 'UNVERIFIED',
      stateReason: 'NO_SUPPLIER_VERIFICATION_PERFORMED',
      createdBy: input.actorId,
    })
    .returning();

  return row;
}
