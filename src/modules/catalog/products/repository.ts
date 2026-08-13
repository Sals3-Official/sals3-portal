import { and, asc, eq } from 'drizzle-orm';

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
 * rewrites the public revision (spec §6.2), it creates the next draft here.
 * The partial unique index `product_revisions_open_draft_key` is what makes
 * that safe — a second concurrent fork collides instead of producing two
 * rival drafts of the same product.
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
): Promise<ProductRevisionRow> {
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
    .returning();

  return row;
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
export async function updateProductTitleForSteward(
  executor: Executor,
  input: {
    productId: string;
    stewardSellerAccountId: string;
    title: string;
    actorId: string;
  },
): Promise<ProductRow | null> {
  const [row] = await executor
    .update(products)
    .set({
      title: input.title,
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

export async function insertDraftVariant(
  executor: Executor,
  input: {
    productId: string;
    sals3Sku: string;
    weightGrams: number | null;
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
      weightGrams: input.weightGrams,
      lengthMillimeters: null,
      widthMillimeters: null,
      heightMillimeters: null,
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
