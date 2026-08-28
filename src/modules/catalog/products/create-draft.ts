import { z } from 'zod';

import getDb, { type Database } from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import { ACTIVE_TAXONOMY_VERSION, type ProductRow } from '@/lib/db/schema';
import {
  appendAuditEvent,
  findEvaluationByCandidateId,
  findIdempotencyRecord,
  findSnapshotByCandidateId,
  insertIdempotencyRecordIfAbsent,
  type Executor,
} from '@/modules/catalog/candidates/repository';
import { feedSnapshotSchema } from '@/modules/catalog/candidates/rules/contracts';
import { ensureCjCategoryMirror } from '@/modules/catalog/taxonomy/cj-mirror';
import {
  assignProductCategory,
  findCategoryByCode,
} from '@/modules/catalog/taxonomy/repository';
import { resolveCategoryMapping } from '@/modules/catalog/taxonomy/resolver';
import { isMappedDecision } from '@/modules/catalog/taxonomy/types';
import {
  findAuthorizedDestination,
  resolveSellerMarketCapabilities,
} from '@/modules/market-config/capabilities';
import resolveOfferDestinations from '@/modules/market-config/offer-destinations';
import { resolveProductPricing } from '@/modules/pricing/resolver';

import {
  CREATE_PRODUCT_DRAFT_OPERATION,
  IDEMPOTENCY_RETENTION_MS,
  PRODUCT_AUDIT_ACTIONS,
  type DraftMissingRequirement,
  type ProductDraftResult,
} from './contracts';
import {
  checksumOfDescriptionDocument,
  emptyDescriptionDocument,
} from './description-document';
import { canonicalRequestHash, deriveSals3Sku } from './identity';
import {
  projectSupplierMediaForProduct,
  SUPPLIER_MEDIA_RIGHTS,
} from './media-projection';
import {
  findBinding,
  findCandidateSourceForSeller,
  findHighestRevisionNumber,
  findOffer,
  findOpenDraftRevision,
  findProductById,
  findProviderProductReference,
  findProviderVariantReference,
  insertDraftRevision,
  insertDraftVariant,
  insertProduct,
  insertProviderProductReference,
  insertProviderVariantReference,
  insertUnpublishedOffer,
  insertUnverifiedBinding,
  listVariantsForProduct,
  setCurrentRevision,
} from './repository';

/**
 * Create-or-retrieve a Sals3 product draft from a persisted supplier
 * candidate.
 *
 * ## What this deliberately does not do
 *
 * **Zero supplier calls.** Everything is read from `supplier_snapshots` and
 * `candidate_evaluations` — rows a previous, separately budgeted evidence
 * fetch already wrote. No `CjSupplierAdapter` is imported anywhere in this
 * module or its transitive imports, which is asserted by test rather than
 * left to review. That preserves CJ points for order-critical work and
 * satisfies ADR-013 §1a's rule that reading a saved snapshot must never make
 * a supplier request.
 *
 * **No fabricated readiness.** A candidate blocked at the cheap screening
 * stage never reached the evidence fetch, so it has no snapshot and therefore
 * no variants, costs, or `vid`s. The flow still creates a real, honest
 * Product and draft Revision for it, and reports
 * `NO_PERSISTED_SUPPLIER_EVIDENCE` — it does not invent a variant, a supplier
 * variant id, or a binding out of a summary.
 *
 * ## Idempotency and concurrency
 *
 * The idempotency record is written inside the same transaction as the
 * catalog rows, so a crash between "created the product" and "recorded the
 * key" is impossible. Insertion is create-or-nothing on the key's unique
 * index, so two simultaneous duplicate clicks cannot both write: the loser
 * sees zero rows inserted and the transaction rolls back, then replays the
 * winner's stored result on the retry pass.
 *
 * A different request body under an already-used key is a conflict, not a
 * silent overwrite (spec §4.2) — and the rejection itself is audited, because
 * a refused replay is exactly the kind of event that must not vanish.
 */

// --- Stored evidence ------------------------------------------------------------

/**
 * Only the fields this flow reads, validated on the way out of the database.
 *
 * Persisted rows are re-validated rather than trusted: the snapshot may have
 * been written by an older `EVIDENCE_SCHEMA_VERSION`, and a shape mismatch
 * must degrade to "no usable variants" instead of throwing halfway through a
 * transaction. `catchall`-free `passthrough` is unnecessary — unknown keys are
 * simply dropped.
 */
const storedVariantSchema = z.object({
  vid: z.string().min(1),
  sku: z.string().nullish(),
  optionLabel: z.string().nullish(),
  priceUsd: z.number().nonnegative().nullish(),
  weightGrams: z.number().nonnegative().nullish(),
  /**
   * Packed box dimensions in millimetres (`VariantEvidence.lengthMm` and
   * friends). Read here because unknown keys are dropped by this schema: the
   * snapshot has carried them since evidence capture existed, and leaving them
   * out of this subset is what kept `product_variants` empty of dimensions
   * while the editor's "Package dimensions (supplier)" label — built from the
   * same snapshot — showed them.
   */
  lengthMm: z.number().nonnegative().nullish(),
  widthMm: z.number().nonnegative().nullish(),
  heightMm: z.number().nonnegative().nullish(),
  totalInventory: z.number().nonnegative().nullish(),
});

const storedEvidenceSchema = z.object({
  name: z.string().nullish(),
  /** CJ's own category name. Read for provenance, never as a Sals3 category. */
  categoryName: z.string().nullish(),
  variants: z.array(storedVariantSchema).default([]),
  capturedAt: z.string().nullish(),
});

/**
 * The discovery feed snapshot is read through its own canonical schema
 * (`rules/contracts.ts`) rather than a local one-field subset.
 *
 * It used to be `z.object({ name })`, and that single missing line is what made
 * an imported draft look empty: every candidate carries a `category`,
 * `categoryId`, `imageUrl`, `sku`, `weight`, and feed price here — the exact
 * facts the Product Sourcing row displays — while only 19 of ~88,000
 * candidates have the richer detail snapshot. Reading one field out of thirteen
 * threw the rest away.
 *
 * Sharing the canonical schema also means a field added to the discovery write
 * path is readable here without a second definition drifting behind it.
 */
const storedFeedSnapshotSchema = feedSnapshotSchema;

const MAX_TITLE_LENGTH = 200;
const USD = 'USD';
const USD_MINOR_PER_UNIT = 100;

/** ADR-003 phase 1. Passed in rather than read inside the pricing resolver. */
const SETTLEMENT_CURRENCY = USD;

/** ADR-001 §3. A CJ-sourced offer is supplier-fulfilled by definition. */
const FULFILLMENT_MODE = 'SUPPLIER_DROPSHIP' as const;

/** Connection states ingestion already treats as workable (ADR-010 §12.7). */
const WORKABLE_CONNECTION_STATUSES = new Set(['CONNECTED', 'DEGRADED']);

/**
 * Unique indexes a losing concurrent writer can legitimately hit inside the
 * transaction. Retrying once lets the loser's second pass read the row the
 * winner created. Any other constraint is a real invariant violation and must
 * surface rather than be retried into a different failure.
 */
const RETRYABLE_CONSTRAINTS = new Set([
  'provider_product_references_provider_external_key',
  'provider_product_references_product_provider_key',
  'provider_variant_references_reference_external_key',
  'provider_variant_references_variant_key',
  'product_variants_sals3_sku_key',
  'product_revisions_open_draft_key',
  'product_revisions_product_number_key',
  'product_offers_seller_variant_market_mode_key',
  'offer_supplier_bindings_offer_connection_variant_key',
  'idempotency_records_key_key',
]);

export type CreateProductDraftOutcome =
  | { ok: true; result: ProductDraftResult }
  | { ok: false; reason: 'not_found' | 'idempotency_conflict' };

type MissingSet = Set<DraftMissingRequirement>;

/** Internal marker: a duplicate key won the race, so this pass must roll back. */
class IdempotencyRaceError extends Error {
  constructor() {
    super('idempotency key claimed concurrently');
    this.name = 'IdempotencyRaceError';
  }
}

function toTitle(
  fallback: string,
  ...preferred: (string | null | undefined)[]
): string {
  const chosen =
    preferred.find(
      (value): value is string =>
        typeof value === 'string' && value.trim() !== '',
    ) ?? fallback;

  return chosen.trim().slice(0, MAX_TITLE_LENGTH);
}

function parseCapturedAt(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string') return null;

  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Asks the taxonomy crosswalk which Sals3 category this supplier category
 * means, and writes the answer when there is one.
 *
 * `modules/catalog/taxonomy/` has been complete since the mapping pilot, and
 * its own module comment recorded the gap this closes: "There is no Server
 * Action, route handler, or UI calling this today." So every draft was created
 * `UNMAPPED` even when an approved, active mapping existed for its CJ category.
 *
 * Since 2026-08-14 (owner decision, Bogs), a supplier category with no
 * reviewed rule no longer leaves the product `UNMAPPED`: the CJ category IS
 * the Sals3 category, so `ensureCjCategoryMirror` creates a 1:1 mirror rule
 * and the product is categorised by the supplier's own category. Only a
 * candidate with no provider category id at all stays `UNMAPPED`.
 *
 * Properties kept from the taxonomy module's design:
 *
 * - **Nothing here can choose a category.** There is no category parameter.
 *   A category comes from an `ACTIVE` mapping row keyed to the provider's own
 *   category id — reviewed when one exists, the automatic mirror otherwise.
 *   A seller still cannot hand-pick which pricing policy applies.
 * - **A reviewed rule outranks the mirror.** The resolver is asked first, and
 *   the mirror only fills absence — it never overwrites an owner-reviewed
 *   mapping. `taxonomy/authorization.ts` still denies interactive governance
 *   to every portal role, and `taxonomy/boundaries.test.ts` still holds
 *   because no file under `src/app` imports the taxonomy repository — this
 *   module does.
 * - **It runs inside the caller's transaction.** `applyResolvedCategoryToProduct`
 *   is deliberately not used: it opens its own transaction, and the draft flow
 *   needs the category, the audit event, and the idempotency record to commit
 *   or roll back together.
 *
 * Returns whether a category is now on the product, so the caller reports
 * `CATEGORY_MAPPING_REQUIRED` from the real outcome instead of assuming it.
 */
async function assignResolvedCategory(
  executor: Executor,
  input: {
    product: ProductRow;
    stewardSellerAccountId: string;
    externalCategoryId: string | null;
    observedCategoryPath: string | null;
    actorId: string;
  },
): Promise<boolean> {
  const decision = await resolveCategoryMapping(executor, {
    provider: 'CJ_DROPSHIPPING',
    externalCategoryId: input.externalCategoryId,
    observedCategoryPath: input.observedCategoryPath,
    taxonomyVersion: ACTIVE_TAXONOMY_VERSION,
    // A draft being created has recorded no mapping version of its own yet, so
    // there is nothing to revalidate against.
    expectedMappingVersion: input.product.categoryMappingVersion,
  });

  let assignment: {
    category: { id: string; code: string; path: string };
    confidence: 'EXACT' | 'ACCEPTABLE';
    mappingId: string;
    mappingVersion: number;
    taxonomyVersion: string;
  } | null = null;

  if (isMappedDecision(decision)) {
    const category = await findCategoryByCode(
      executor,
      decision.sals3CategoryCode,
    );

    // Unreachable while the resolver's own guarantees hold; treated as "not
    // mapped" rather than trusted, because a missing target row is a data
    // problem and inventing a category id from it would be worse.
    if (category === null) return false;

    assignment = {
      category,
      confidence: decision.confidence,
      mappingId: decision.mappingId,
      mappingVersion: decision.mappingVersion,
      taxonomyVersion: decision.taxonomyVersion,
    };
  } else {
    // No reviewed rule covers this supplier category, so the supplier's own
    // category becomes the Sals3 category through the mirror (owner decision
    // 2026-08-14). `null` still means "not mapped" — a candidate with no
    // provider category id has nothing to mirror.
    const mirrored = await ensureCjCategoryMirror(executor, {
      provider: 'CJ_DROPSHIPPING',
      externalCategoryId: input.externalCategoryId,
      observedCategoryPath: input.observedCategoryPath,
      actorId: input.actorId,
    });

    if (
      mirrored === null ||
      mirrored.category === null ||
      (mirrored.mapping.confidence !== 'EXACT' &&
        mirrored.mapping.confidence !== 'ACCEPTABLE')
    ) {
      return false;
    }

    assignment = {
      category: mirrored.category,
      confidence: mirrored.mapping.confidence,
      mappingId: mirrored.mapping.id,
      mappingVersion: mirrored.mapping.mappingVersion,
      taxonomyVersion: mirrored.mapping.taxonomyVersion,
    };
  }

  const updated = await assignProductCategory(executor, {
    productId: input.product.id,
    stewardSellerAccountId: input.stewardSellerAccountId,
    expectedVersion: input.product.version,
    categoryId: assignment.category.id,
    categoryMappingConfidence: assignment.confidence,
    categoryMappingId: assignment.mappingId,
    categoryMappingVersion: assignment.mappingVersion,
    actorId: input.actorId,
  });

  if (updated === null) return false;

  await appendAuditEvent(executor, {
    actorId: input.actorId,
    action: PRODUCT_AUDIT_ACTIONS.categoryAssigned,
    entityType: 'Product',
    entityId: updated.id,
    payload: {
      categoryCode: assignment.category.code,
      categoryPath: assignment.category.path,
      confidence: assignment.confidence,
      mappingId: assignment.mappingId,
      mappingVersion: assignment.mappingVersion,
      taxonomyVersion: assignment.taxonomyVersion,
      externalCategoryId: input.externalCategoryId,
      resolverVersion: decision.resolverVersion,
    },
  });

  return true;
}

async function runDraftTransaction(
  database: Database,
  input: {
    candidateId: string;
    sellerAccountId: string;
    actorId: string;
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<CreateProductDraftOutcome> {
  return database.transaction(async (tx) => {
    const source = await findCandidateSourceForSeller(
      tx,
      input.candidateId,
      input.sellerAccountId,
    );

    // Unknown candidate, another tenant's candidate, and a candidate reached
    // through a connection this seller does not own are one answer.
    if (source === null) return { ok: false as const, reason: 'not_found' };

    const missing: MissingSet = new Set();

    const [snapshot, evaluation] = await Promise.all([
      findSnapshotByCandidateId(tx, input.candidateId),
      findEvaluationByCandidateId(tx, input.candidateId),
    ]);

    const evidence =
      snapshot === null
        ? null
        : (storedEvidenceSchema.safeParse(snapshot.evidence).data ?? null);
    const feed =
      evaluation === null
        ? null
        : (storedFeedSnapshotSchema.safeParse(evaluation.feedSnapshot).data ??
          null);
    const feedName = feed?.name ?? null;

    if (evidence === null) missing.add('NO_PERSISTED_SUPPLIER_EVIDENCE');

    const observedAt = parseCapturedAt(evidence?.capturedAt);

    // --- Canonical product + provider product reference ---------------------

    let reference = await findProviderProductReference(
      tx,
      source.supplierProviderId,
      source.externalProductId,
    );
    let product =
      reference === null
        ? null
        : await findProductById(tx, reference.productId);

    if (product === null) {
      product = await insertProduct(tx, {
        stewardSellerAccountId: input.sellerAccountId,
        title: toTitle(
          `Supplier product ${source.externalProductId}`,
          evidence?.name,
          feedName,
        ),
        actorId: input.actorId,
      });

      reference = await insertProviderProductReference(tx, {
        productId: product.id,
        supplierProviderId: source.supplierProviderId,
        externalProductId: source.externalProductId,
        sourceCandidateId: source.candidateId,
        snapshotChecksum: snapshot?.checksum ?? null,
        lastObservedAt: observedAt,
        actorId: input.actorId,
      });

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: PRODUCT_AUDIT_ACTIONS.productCreated,
        entityType: 'Product',
        entityId: product.id,
        payload: {
          stewardSellerAccountId: input.sellerAccountId,
          candidateId: source.candidateId,
          supplierProviderCode: source.supplierProviderCode,
          externalProductId: source.externalProductId,
          providerProductReferenceId: reference.id,
          publicationState: product.publicationState,
        },
      });
    } else {
      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: PRODUCT_AUDIT_ACTIONS.productReused,
        entityType: 'Product',
        entityId: product.id,
        payload: {
          requestingSellerAccountId: input.sellerAccountId,
          candidateId: source.candidateId,
          externalProductId: source.externalProductId,
          stewarded: product.stewardSellerAccountId === input.sellerAccountId,
        },
      });
    }

    // `reference` is non-null on both branches; narrowing for TypeScript.
    if (reference === null) throw new Error('provider reference unresolved');

    const isSteward = product.stewardSellerAccountId === input.sellerAccountId;

    if (!isSteward) {
      missing.add('EDITORIAL_RECORD_STEWARDED_BY_ANOTHER_SELLER');
    }

    // --- Draft revision (steward only) --------------------------------------

    let revisionId: string | null = null;

    if (isSteward) {
      const openDraft = await findOpenDraftRevision(tx, product.id);

      if (openDraft !== null) {
        revisionId = openDraft.id;
      } else {
        const highest = await findHighestRevisionNumber(tx, product.id);
        const document = emptyDescriptionDocument();
        const revision = await insertDraftRevision(tx, {
          productId: product.id,
          revisionNumber: highest + 1,
          expectedProductVersion: product.version,
          contentDocument: document,
          contentChecksum: checksumOfDescriptionDocument(document),
          actorId: input.actorId,
        });

        if (revision === null) {
          /**
           * The open-draft index refused a second draft: something else — a
           * concurrent import, or `openDraftForEdit` forking this product for
           * an edit — created one between the read above and this insert.
           *
           * Adopting the winner is the same answer the `openDraft !== null`
           * branch above gives, and it is right *here* specifically because
           * this is the import pipeline: it wants the product to have an open
           * draft, not to own the one it created. An editing save must never
           * do this — see `open-draft-for-edit.ts`, which refuses instead.
           */
          const winner = await findOpenDraftRevision(tx, product.id);

          if (winner === null) {
            throw new Error('draft revision insert produced no row');
          }

          revisionId = winner.id;
        } else {
          revisionId = revision.id;
          await setCurrentRevision(tx, {
            productId: product.id,
            revisionId: revision.id,
            actorId: input.actorId,
          });

          await appendAuditEvent(tx, {
            actorId: input.actorId,
            action: PRODUCT_AUDIT_ACTIONS.revisionCreated,
            entityType: 'ProductRevision',
            entityId: revision.id,
            payload: {
              productId: product.id,
              revisionNumber: revision.revisionNumber,
              workflowState: revision.workflowState,
              contentChecksum: revision.contentChecksum,
              forkedFromProductVersion: product.version,
            },
          });
        }
      }

      missing.add('STRUCTURED_DESCRIPTION_REQUIRED');
    }

    // --- Sals3 category, through the approved crosswalk ---------------------

    // Only the steward may write the editorial record, and `products.category_id`
    // is part of it (see that table's own comment). A seller reusing another
    // account's product gets offers, never a category write.
    //
    // Placed after the revision block on purpose: `assignProductCategory` bumps
    // `products.version` on success, and `insertDraftRevision` above records the
    // version it forked from.
    const categoryMapped =
      isSteward &&
      (product.categoryId !== null ||
        (await assignResolvedCategory(tx, {
          product,
          stewardSellerAccountId: input.sellerAccountId,
          externalCategoryId: source.providerCategoryId,
          // CJ's own category name, kept as the observed path the mapping was
          // recorded against. Evidence first: it comes from a product-detail
          // fetch, while the feed snapshot is a list-level summary.
          observedCategoryPath:
            evidence?.categoryName ?? feed?.category ?? null,
          actorId: input.actorId,
        })));

    if (isSteward && !categoryMapped) missing.add('CATEGORY_MAPPING_REQUIRED');

    // --- Variants + provider variant references -----------------------------

    const evidenceVariants = evidence?.variants ?? [];

    if (evidence !== null && evidenceVariants.length === 0) {
      missing.add('NO_SUPPLIER_VARIANTS_IN_EVIDENCE');
    }

    const variantIds: string[] = [];
    const providerVariantReferenceByVariantId = new Map<string, string>();

    // eslint-disable-next-line no-restricted-syntax -- sequential: each pass reads state a previous pass may have written, inside one transaction.
    for (const evidenceVariant of evidenceVariants) {
      // Sequential on purpose: each iteration reads state the previous one may
      // have written, and the whole loop shares one transaction's connection.
      // eslint-disable-next-line no-await-in-loop
      const existingProviderVariant = await findProviderVariantReference(
        tx,
        reference.id,
        evidenceVariant.vid,
      );

      if (existingProviderVariant !== null) {
        variantIds.push(existingProviderVariant.variantId);
        providerVariantReferenceByVariantId.set(
          existingProviderVariant.variantId,
          existingProviderVariant.id,
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      const sals3Sku = deriveSals3Sku({
        providerCode: source.supplierProviderCode,
        externalProductId: source.externalProductId,
        externalVariantId: evidenceVariant.vid,
      });

      // eslint-disable-next-line no-await-in-loop
      const variant = await insertDraftVariant(tx, {
        productId: product.id,
        sals3Sku,
        weightGrams: evidenceVariant.weightGrams ?? null,
        lengthMillimeters: evidenceVariant.lengthMm ?? null,
        widthMillimeters: evidenceVariant.widthMm ?? null,
        heightMillimeters: evidenceVariant.heightMm ?? null,
        actorId: input.actorId,
      });

      const costMinor =
        typeof evidenceVariant.priceUsd === 'number'
          ? BigInt(Math.round(evidenceVariant.priceUsd * USD_MINOR_PER_UNIT))
          : null;

      // eslint-disable-next-line no-await-in-loop
      const providerVariant = await insertProviderVariantReference(tx, {
        providerProductReferenceId: reference.id,
        variantId: variant.id,
        externalVariantId: evidenceVariant.vid,
        externalSku: evidenceVariant.sku ?? null,
        // Preserved verbatim; never split into Sals3 option axes.
        sourceOptionLabel: evidenceVariant.optionLabel ?? null,
        lastObservedCostMinor: costMinor,
        lastObservedCostCurrency: costMinor === null ? null : USD,
        lastObservedInventory: evidenceVariant.totalInventory ?? null,
        lastObservedAt: observedAt,
        actorId: input.actorId,
      });

      variantIds.push(variant.id);
      providerVariantReferenceByVariantId.set(variant.id, providerVariant.id);

      // eslint-disable-next-line no-await-in-loop
      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: PRODUCT_AUDIT_ACTIONS.variantCreated,
        entityType: 'ProductVariant',
        entityId: variant.id,
        payload: {
          productId: product.id,
          sals3Sku: variant.sals3Sku,
          status: variant.status,
          providerVariantReferenceId: providerVariant.id,
          externalVariantId: evidenceVariant.vid,
          optionCombinationKey: variant.optionCombinationKey,
        },
      });
    }

    if (variantIds.length === 0 && evidenceVariants.length === 0) {
      // Nothing was created this pass; a replay of an earlier pass may still
      // have variants on the canonical product.
      const existing = await listVariantsForProduct(tx, product.id);
      existing.forEach((variant) => variantIds.push(variant.id));
    }

    if (variantIds.length > 0) missing.add('PRODUCT_OPTIONS_UNMAPPED');

    // --- Supplier media provenance ------------------------------------------

    // The same projection `publish.ts` runs, run at import time instead of only
    // at publication. It reads `supplier_snapshots.evidence.imageUrls` first and
    // falls back to `candidate_evaluations.feed_snapshot.imageUrl`, so a
    // candidate that only ever went through discovery still gets the one honest
    // photo the database holds. Zero supplier calls: both are stored rows.
    //
    // Steward-only, for the same reason as the category above — this writes to
    // another tenant's product record otherwise.
    if (isSteward) {
      const media = await projectSupplierMediaForProduct(tx, {
        productId: product.id,
        candidateId: source.candidateId,
        actorId: input.actorId,
        rights: SUPPLIER_MEDIA_RIGHTS,
      });

      if (media.source === 'NONE') missing.add('MEDIA_SOURCE_NOT_RECORDED');
    } else {
      missing.add('MEDIA_SOURCE_NOT_RECORDED');
    }

    // --- Pricing (server-owned, ADR-015) ------------------------------------

    // The existing resolver is called rather than reimplemented, so no second
    // pricing formula can drift from it. Today it always declines: a CJ
    // product has no mapped Sals3 category, and the resolver refuses to price
    // an unmapped one. That refusal is recorded, not papered over.
    const pricing = await resolveProductPricing(tx, {
      sellerAccountId: input.sellerAccountId,
      categoryCode: null,
      categoryMappingConfidence: 'UNMAPPED',
      supplierCandidateId: source.candidateId,
      supplierVariantId: null,
      supplierCost: null,
      supplierCostObservedAt: observedAt?.toISOString() ?? null,
      /**
       * Empty on purpose, and not a stand-in country.
       *
       * A draft is not being priced for anywhere yet — the destination is
       * decided at publication, from the seller's own market profile. Passing
       * `'AU'` here to satisfy the type would be exactly the inferred
       * commercial input ADR-015's amendment refuses, and it would read as a
       * real decision to whoever found it next.
       *
       * The resolver refuses this call on `CATEGORY_MAPPING_REQUIRES_REVIEW`
       * before the market is ever examined, so the recorded reason is unchanged
       * by this field. If that ever stops being true, `MARKET_REQUIRED` is the
       * honest answer and this line is what produces it.
       */
      marketCode: '',
      settlementCurrency: SETTLEMENT_CURRENCY,
    });

    const pricingUnavailableReason =
      pricing.outcome === 'PRICING_UNAVAILABLE' ? pricing.reason : null;

    if (pricingUnavailableReason !== null) missing.add('PRICING_UNRESOLVED');

    // --- Offers + supplier bindings -----------------------------------------

    // One resolver, shared with `publish.ts`. It used to live here as a
    // second implementation that required an `ACTIVE` seller profile while
    // publish fell back to the platform list — so a draft could be created
    // with no offers at all and then publish perfectly well, and in between
    // Save Draft could not write a price to it.
    const destinations = await resolveOfferDestinations(
      tx,
      input.sellerAccountId,
    );

    if (destinations.length === 0) missing.add('NO_ACTIVE_MARKET_PROFILE');

    const connectionWorkable = WORKABLE_CONNECTION_STATUSES.has(
      source.connectionStatus,
    );

    if (!connectionWorkable) missing.add('SUPPLIER_CONNECTION_UNHEALTHY');

    const capabilities = resolveSellerMarketCapabilities();
    const offerIds: string[] = [];

    // An offer needs something sellable to point at and an authorized market.
    // Without both, the draft stays a product and a revision — no empty offer
    // standing in for one.
    // eslint-disable-next-line no-restricted-syntax -- see above; one transaction, ordered writes.
    for (const variantId of variantIds) {
      // eslint-disable-next-line no-restricted-syntax -- see above.
      for (const destination of destinations) {
        /* eslint-disable no-await-in-loop */
        const existingOffer = await findOffer(tx, {
          sellerAccountId: input.sellerAccountId,
          variantId,
          marketCode: destination.marketCode,
          fulfillmentMode: FULFILLMENT_MODE,
        });

        const offer =
          existingOffer ??
          (await insertUnpublishedOffer(tx, {
            sellerAccountId: input.sellerAccountId,
            variantId,
            marketCode: destination.marketCode,
            fulfillmentMode: FULFILLMENT_MODE,
            marketProfileId: destination.profileId,
            marketCapabilityVersion: capabilities.capabilityVersion,
            pricingUnavailableReason:
              pricingUnavailableReason ?? 'PRICING_NOT_ATTEMPTED',
            actorId: input.actorId,
          }));

        offerIds.push(offer.id);

        if (existingOffer === null) {
          await appendAuditEvent(tx, {
            actorId: input.actorId,
            action: PRODUCT_AUDIT_ACTIONS.offerCreated,
            entityType: 'ProductOffer',
            entityId: offer.id,
            payload: {
              sellerAccountId: input.sellerAccountId,
              variantId,
              marketCode: destination.marketCode,
              fulfillmentMode: FULFILLMENT_MODE,
              publishState: offer.publishState,
              pricingState: offer.pricingState,
              pricingUnavailableReason: offer.pricingUnavailableReason,
              marketProfileId: destination.profileId,
              marketCapabilityVersion: capabilities.capabilityVersion,
            },
          });
        }

        const providerVariantReferenceId =
          providerVariantReferenceByVariantId.get(variantId) ?? null;

        // A binding asserts "this offer is fulfilled through this exact
        // supplier variant on this seller's own connection". Both facts must
        // be real, so an unhealthy connection or an unmapped provider variant
        // produces no binding rather than an aspirational one.
        if (connectionWorkable && providerVariantReferenceId !== null) {
          const existingBinding = await findBinding(tx, {
            offerId: offer.id,
            supplierConnectionId: source.supplierConnectionId,
            providerVariantReferenceId,
          });

          if (existingBinding === null) {
            const binding = await insertUnverifiedBinding(tx, {
              offerId: offer.id,
              supplierConnectionId: source.supplierConnectionId,
              providerVariantReferenceId,
              actorId: input.actorId,
            });

            await appendAuditEvent(tx, {
              actorId: input.actorId,
              action: PRODUCT_AUDIT_ACTIONS.bindingCreated,
              entityType: 'OfferSupplierBinding',
              entityId: binding.id,
              payload: {
                offerId: offer.id,
                providerVariantReferenceId,
                state: binding.state,
                stateReason: binding.stateReason,
              },
            });
          }
        }
        /* eslint-enable no-await-in-loop */
      }
    }

    const result: ProductDraftResult = {
      productId: product.id,
      revisionId,
      variantIds,
      offerIds,
      publicationState: 'UNPUBLISHED',
      missingRequirements: [...missing],
      pricingUnavailableReason,
      replayed: false,
    };

    // --- Idempotency record (same transaction as every write above) ---------

    const recorded = await insertIdempotencyRecordIfAbsent(tx, {
      key: input.idempotencyKey,
      actorId: input.actorId,
      operation: CREATE_PRODUCT_DRAFT_OPERATION,
      requestHash: input.requestHash,
      resultReference: result as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
    });

    if (!recorded) {
      // A concurrent duplicate won the key. Abort so nothing this pass wrote
      // survives, and let the retry replay the winner's stored result.
      throw new IdempotencyRaceError();
    }

    return { ok: true as const, result };
  });
}

/**
 * Replays a stored result, or reports a conflict when the same key arrives
 * with a different canonical request (spec §4.2's `IDEMPOTENCY_CONFLICT`).
 */
async function replayStoredResult(
  executor: Executor,
  input: { idempotencyKey: string; requestHash: string },
): Promise<CreateProductDraftOutcome | null> {
  const record = await findIdempotencyRecord(executor, input.idempotencyKey);

  if (record === null) return null;

  if (
    record.operation !== CREATE_PRODUCT_DRAFT_OPERATION ||
    record.requestHash !== input.requestHash
  ) {
    return { ok: false, reason: 'idempotency_conflict' };
  }

  return {
    ok: true,
    result: {
      ...(record.resultReference as unknown as ProductDraftResult),
      replayed: true,
    },
  };
}

const MAX_ATTEMPTS = 2;

export default async function createProductDraftFromCandidate(input: {
  candidateId: string;
  sellerAccountId: string;
  actorId: string;
  idempotencyKey: string;
  database?: Database;
}): Promise<CreateProductDraftOutcome> {
  const database = input.database ?? getDb();

  // The hash covers exactly the facts that make two requests the same
  // operation. The actor is excluded on purpose: the same seller retrying
  // from a different session is the same request, while a *different* seller
  // is already excluded because the tenant is part of the hash.
  const requestHash = canonicalRequestHash({
    operation: CREATE_PRODUCT_DRAFT_OPERATION,
    candidateId: input.candidateId,
    sellerAccountId: input.sellerAccountId,
  });

  const replay = await replayStoredResult(database, {
    idempotencyKey: input.idempotencyKey,
    requestHash,
  });

  if (replay !== null) {
    if (!replay.ok) {
      await appendAuditEvent(database, {
        actorId: input.actorId,
        action: PRODUCT_AUDIT_ACTIONS.draftRequestConflict,
        entityType: 'IdempotencyKey',
        entityId: input.idempotencyKey,
        payload: {
          operation: CREATE_PRODUCT_DRAFT_OPERATION,
          sellerAccountId: input.sellerAccountId,
          candidateId: input.candidateId,
        },
      });
    }

    return replay;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await runDraftTransaction(database, {
        candidateId: input.candidateId,
        sellerAccountId: input.sellerAccountId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      });
    } catch (error) {
      lastError = error;

      const constraint = uniqueViolationConstraint(error);
      const retryable =
        error instanceof IdempotencyRaceError ||
        (constraint !== null && RETRYABLE_CONSTRAINTS.has(constraint));

      if (!retryable || attempt === MAX_ATTEMPTS) break;

      // eslint-disable-next-line no-await-in-loop
      const afterRace = await replayStoredResult(database, {
        idempotencyKey: input.idempotencyKey,
        requestHash,
      });

      if (afterRace !== null) return afterRace;
    }
  }

  throw lastError;
}
