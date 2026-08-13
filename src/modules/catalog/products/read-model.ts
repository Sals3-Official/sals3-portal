import 'server-only';

import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';

import getDb, { type Database } from '@/lib/db/client';
import { cjImageUrl } from '@/lib/cj/primitives';
import {
  candidateEvaluations,
  offerSupplierBindings,
  productMediaSources,
  productOffers,
  productRevisions,
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  sals3Categories,
  supplierCandidates,
  supplierConnections,
  supplierProviders,
  supplierSnapshots,
  type OfferPublishState,
  type OfferSupplierBindingState,
  type ProductPublicationState,
  type ProductRevisionRow,
  type ProductRow,
} from '@/lib/db/schema';
import type {
  AttentionReasonFixture,
  Availability,
  CatalogueProductFixture,
  CatalogueVariantFixture,
  EvidenceFreshness,
  ListingStatus,
  StockEvidenceKind,
  SupplierConnectionHealth,
} from '@/lib/seller-center/product-catalogue/types';
import type {
  MarketEvidenceFixture,
  MediaItemFixture,
  MoneyValue,
  ProductEditorFixture,
  ReadinessIssue,
  SpecificationFixture,
  SupplierConnectionStatus,
  VariantFixture,
  VariantPricingGuidance,
} from '@/lib/seller-center/product-editor/types';
import { feedSnapshotSchema } from '@/modules/catalog/candidates/rules/contracts';
import { descriptionDocumentSchema } from './description-document';

type Executor = Database;

const USD = 'USD';
const ZERO_USD: MoneyValue = { amountMinor: 0, currency: USD };

const evidenceVariantSchema = z.object({
  vid: z.string().min(1),
  sku: z.string().nullish(),
  optionLabel: z.string().nullish(),
  priceUsd: z.number().nonnegative().nullish(),
  weightGrams: z.number().nonnegative().nullish(),
  totalInventory: z.number().nonnegative().nullish(),
});

const evidenceSchema = z.object({
  name: z.string().nullish(),
  categoryName: z.string().nullish(),
  capturedAt: z.string().nullish(),
  variants: z.array(evidenceVariantSchema).default([]),
});

/**
 * The supplier's own facts about a product, as the database already holds them.
 *
 * Everything here comes from `candidate_evaluations.feed_snapshot` — the row
 * discovery writes for every candidate — with the richer detail snapshot
 * preferred where it exists. It is read through the canonical
 * `feedSnapshotSchema` rather than a local subset, so a field added on the
 * write path is readable here without a second definition drifting behind it.
 *
 * These are shown as supplier evidence and never as Sals3 decisions. A CJ
 * category name is not a Sals3 category, and a feed price is not a selling
 * price: `priceUsdCents` was verified on 2026-08-13 to be the *lowest* variant
 * price, so it is labelled a "from" reference and never used to price anything.
 */
type SupplierFacts = {
  categoryPath: string | null;
  categoryId: string | null;
  sku: string | null;
  weightLabel: string | null;
  fromPrice: MoneyValue | null;
  shipsFrom: string[];
  listedCount: number | null;
  imageUrl: string | null;
};

const NO_SUPPLIER_FACTS: SupplierFacts = {
  categoryPath: null,
  categoryId: null,
  sku: null,
  weightLabel: null,
  fromPrice: null,
  shipsFrom: [],
  listedCount: null,
  imageUrl: null,
};

/**
 * Re-checks a stored image address against the CJ host allow-list on the way
 * out of the database.
 *
 * Not redundant with the check at intake: `feed_snapshot.imageUrl` is a plain
 * string column, `next.config.ts` sets `images.loader: 'custom'` so
 * `remotePatterns` enforces nothing at request time, and whatever string
 * reaches a rendered `src` becomes a browser `GET` from the seller's own
 * session. Same reasoning, and the same `cjImageUrl` gate, as
 * `components/products/cj/candidate-view.ts`'s `imageUrl()` on the pipeline
 * read path.
 */
function allowedImageUrl(value: unknown): string | null {
  const parsed = cjImageUrl.safeParse(value);

  return parsed.success ? parsed.data : null;
}

function supplierFacts(
  feedSnapshot: unknown,
  evidence: z.infer<typeof evidenceSchema> | null,
  mediaUrl: string | null,
): SupplierFacts {
  const feed = feedSnapshotSchema.safeParse(feedSnapshot);

  if (!feed.success) {
    return { ...NO_SUPPLIER_FACTS, imageUrl: allowedImageUrl(mediaUrl) };
  }

  const cents = feed.data.priceUsdCents;

  return {
    // Evidence first: a product-detail fetch is more specific than the
    // list-level summary discovery wrote.
    categoryPath: evidence?.categoryName ?? feed.data.category ?? null,
    categoryId: feed.data.categoryId ?? null,
    sku: feed.data.sku ?? null,
    weightLabel: feed.data.weight ?? null,
    fromPrice: cents === null ? null : { amountMinor: cents, currency: USD },
    shipsFrom: feed.data.shipsFrom,
    listedCount: feed.data.listedCount,
    // A recorded media row outranks the feed field: it is the address that
    // carries a rights basis and an observation time.
    imageUrl: allowedImageUrl(mediaUrl) ?? allowedImageUrl(feed.data.imageUrl),
  };
}

function toNumber(value: bigint | null): number | null {
  if (value === null) return null;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  return Number(value);
}

function money(
  value: bigint | null,
  currency: string | null,
): MoneyValue | null {
  const amountMinor = toNumber(value);

  if (amountMinor === null || currency === null) return null;

  return { amountMinor, currency };
}

function groupBy<T, K extends string>(
  values: T[],
  keyOf: (value: T) => K,
): Map<K, T[]> {
  const grouped = new Map<K, T[]>();

  values.forEach((value) => {
    const key = keyOf(value);
    const current = grouped.get(key) ?? [];

    current.push(value);
    grouped.set(key, current);
  });

  return grouped;
}

function iso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value !== '') return value;

  return new Date(0).toISOString();
}

function listingStatus(
  publicationState: ProductPublicationState,
  offerState: OfferPublishState | null,
  attentionReasons: AttentionReasonFixture[],
): ListingStatus {
  if (publicationState === 'ARCHIVED' || offerState === 'ARCHIVED') {
    return 'ARCHIVED';
  }

  if (publicationState === 'PAUSED' || offerState === 'PAUSED') {
    return 'AUTO_PAUSED';
  }

  if (publicationState === 'PUBLISHED' && offerState === 'PUBLISHED') {
    return attentionReasons.length > 0 ? 'LIVE_NEEDS_ATTENTION' : 'LIVE';
  }

  return 'DRAFT';
}

function availability(
  state: 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE' | null,
): Availability {
  if (state === 'AVAILABLE') return 'AVAILABLE';
  if (state === 'UNAVAILABLE') return 'OUT_OF_STOCK';

  return 'UNKNOWN_OR_STALE';
}

function stockEvidence(quantity: number | null): StockEvidenceKind {
  if (quantity === null) return 'UNKNOWN_STOCK';
  if (quantity <= 0) return 'ZERO_STOCK';

  return 'UNKNOWN_STOCK';
}

function evidenceFreshness(observedAt: Date | null): EvidenceFreshness {
  if (observedAt === null) return 'UNKNOWN';

  const ageMs = Date.now() - observedAt.getTime();

  return ageMs > 72 * 60 * 60 * 1000 ? 'STALE' : 'FRESH';
}

function connectionHealth(
  status: string | null | undefined,
): SupplierConnectionHealth {
  if (status === 'CONNECTED') return 'CONNECTED';
  if (status === 'DEGRADED' || status === 'PENDING') return 'DEGRADED';

  return 'DISCONNECTED';
}

function editorConnectionStatus(
  status: string | null | undefined,
): SupplierConnectionStatus {
  if (
    status === 'CONNECTED' ||
    status === 'DEGRADED' ||
    status === 'REAUTH_REQUIRED' ||
    status === 'DISCONNECTED' ||
    status === 'REVOKED'
  ) {
    return status;
  }

  return 'DISCONNECTED';
}

function editorVariantListingState(
  product: CatalogueProductFixture,
  variant: CatalogueVariantFixture,
): VariantFixture['listingState'] {
  if (product.status === 'AUTO_PAUSED') return 'PAUSED';
  if (variant.availability === 'AVAILABLE') return 'WILL_LIST';

  return 'NOT_LISTED';
}

function editorListingState(
  product: CatalogueProductFixture,
): ProductEditorFixture['listingState'] {
  if (product.status === 'AUTO_PAUSED') return 'PUBLISHED_PAUSED';

  if (product.status === 'LIVE' || product.status === 'LIVE_NEEDS_ATTENTION') {
    return 'PUBLISHED';
  }

  return 'DRAFT';
}

function attentionFromUnpublished(
  product: ProductRow,
  hasUnpricedOffer: boolean,
): AttentionReasonFixture[] {
  if (product.publicationState !== 'UNPUBLISHED' && !hasUnpricedOffer) {
    return [];
  }

  const reasons: AttentionReasonFixture[] = [];

  if (product.publicationState === 'UNPUBLISHED') {
    reasons.push({
      id: `${product.id}-not-published`,
      severity: 'MEDIUM',
      reasonCode: 'PUBLICATION_NOT_BUILT',
      summary:
        'This product exists in the catalogue database but is not published yet.',
      checkoutAllowed: false,
    });
  }

  if (hasUnpricedOffer) {
    reasons.push({
      id: `${product.id}-price-unresolved`,
      severity: 'HIGH',
      reasonCode: 'PRICING_UNRESOLVED',
      summary:
        'At least one offer has no resolved selling price, so it cannot be live.',
      checkoutAllowed: false,
    });
  }

  return reasons;
}

function descriptionText(revision: ProductRevisionRow | undefined): string {
  const parsed = descriptionDocumentSchema.safeParse(revision?.contentDocument);

  if (!parsed.success) return '';

  return parsed.data.blocks
    .map((block) => {
      if (block.type === 'paragraph' || block.type === 'heading') {
        return block.text;
      }

      if (block.type === 'bulletList') return block.items.join('\n');

      return block.entries
        .map((entry) => `${entry.label}: ${entry.value}`)
        .join('\n');
    })
    .join('\n\n');
}

async function listCoreRows(executor: Executor, sellerAccountId: string) {
  const offerProductRows = await executor
    .select({ productId: products.id })
    .from(productOffers)
    .innerJoin(productVariants, eq(productVariants.id, productOffers.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productOffers.sellerAccountId, sellerAccountId));

  const productIds = [...new Set(offerProductRows.map((row) => row.productId))];

  const productScope =
    productIds.length === 0
      ? eq(products.stewardSellerAccountId, sellerAccountId)
      : or(
          eq(products.stewardSellerAccountId, sellerAccountId),
          inArray(products.id, productIds),
        );

  const productRows = await executor
    .select({
      product: products,
      categoryPath: sals3Categories.path,
      categoryCode: sals3Categories.code,
    })
    .from(products)
    .leftJoin(sals3Categories, eq(sals3Categories.id, products.categoryId))
    .where(productScope)
    .orderBy(desc(products.createdAt));

  const ids = productRows.map((row) => row.product.id);

  if (ids.length === 0) {
    return {
      productRows,
      variantRows: [],
      referenceRows: [],
      providerVariantRows: [],
      offerRows: [],
      bindingRows: [],
      revisionRows: [],
      mediaRows: [],
      sourceRows: [],
    };
  }

  const [variantRows, referenceRows, revisionRows, mediaRows] =
    await Promise.all([
      executor
        .select()
        .from(productVariants)
        .where(inArray(productVariants.productId, ids))
        .orderBy(asc(productVariants.sals3Sku)),
      executor
        .select()
        .from(providerProductReferences)
        .where(inArray(providerProductReferences.productId, ids)),
      executor
        .select()
        .from(productRevisions)
        .where(inArray(productRevisions.productId, ids)),
      executor
        .select()
        .from(productMediaSources)
        .where(inArray(productMediaSources.productId, ids)),
    ]);

  const variantIds = variantRows.map((row) => row.id);
  const referenceIds = referenceRows.map((row) => row.id);
  const sourceCandidateIds = referenceRows
    .map((row) => row.sourceCandidateId)
    .filter((id): id is string => id !== null);

  const [providerVariantRows, offerRows, sourceRows] = await Promise.all([
    referenceIds.length === 0
      ? Promise.resolve([])
      : executor
          .select()
          .from(providerVariantReferences)
          .where(
            inArray(
              providerVariantReferences.providerProductReferenceId,
              referenceIds,
            ),
          ),
    variantIds.length === 0
      ? Promise.resolve([])
      : executor
          .select()
          .from(productOffers)
          .where(
            and(
              eq(productOffers.sellerAccountId, sellerAccountId),
              inArray(productOffers.variantId, variantIds),
            ),
          ),
    sourceCandidateIds.length === 0
      ? Promise.resolve([])
      : executor
          .select({
            candidate: supplierCandidates,
            evaluation: candidateEvaluations,
            snapshot: supplierSnapshots,
            connection: supplierConnections,
            provider: supplierProviders,
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
          .leftJoin(
            candidateEvaluations,
            eq(candidateEvaluations.candidateId, supplierCandidates.id),
          )
          .leftJoin(
            supplierSnapshots,
            eq(supplierSnapshots.candidateId, supplierCandidates.id),
          )
          .where(
            and(
              eq(supplierConnections.sellerAccountId, sellerAccountId),
              inArray(supplierCandidates.id, sourceCandidateIds),
            ),
          ),
  ]);

  const offerIds = offerRows.map((row) => row.id);
  const bindingRows =
    offerIds.length === 0
      ? []
      : await executor
          .select()
          .from(offerSupplierBindings)
          .where(inArray(offerSupplierBindings.offerId, offerIds));

  return {
    productRows,
    variantRows,
    referenceRows,
    providerVariantRows,
    offerRows,
    bindingRows,
    revisionRows,
    mediaRows,
    sourceRows,
  };
}

function buildCatalogueProducts(
  rows: Awaited<ReturnType<typeof listCoreRows>>,
): CatalogueProductFixture[] {
  const variantsByProduct = groupBy(
    rows.variantRows,
    (variant) => variant.productId,
  );
  const refsByProduct = groupBy(
    rows.referenceRows,
    (reference) => reference.productId,
  );
  const providerVariantByVariant = new Map(
    rows.providerVariantRows.map((reference) => [
      reference.variantId,
      reference,
    ]),
  );
  const offersByVariant = groupBy(rows.offerRows, (offer) => offer.variantId);
  const bindingsByOffer = groupBy(
    rows.bindingRows,
    (binding) => binding.offerId,
  );
  const revisionsByProduct = groupBy(
    rows.revisionRows,
    (revision) => revision.productId,
  );
  const mediaByProduct = groupBy(rows.mediaRows, (media) => media.productId);
  const sourceByCandidate = new Map(
    rows.sourceRows.map((row) => [row.candidate.id, row]),
  );

  return rows.productRows.map(({ product, categoryPath, categoryCode }) => {
    const variants = variantsByProduct.get(product.id) ?? [];
    const reference = refsByProduct.get(product.id)?.[0];
    const source =
      reference?.sourceCandidateId === null || reference === undefined
        ? undefined
        : sourceByCandidate.get(reference.sourceCandidateId);
    const revision =
      revisionsByProduct
        .get(product.id)
        ?.find((row) => row.id === product.currentRevisionId) ??
      revisionsByProduct.get(product.id)?.[0];
    const media = mediaByProduct.get(product.id) ?? [];
    const productOffersForSeller = variants.flatMap(
      (variant) => offersByVariant.get(variant.id) ?? [],
    );
    const firstOffer = productOffersForSeller[0];
    const hasUnpricedOffer = productOffersForSeller.some(
      (offer) => offer.pricingState === 'UNRESOLVED',
    );
    const attentionReasons = attentionFromUnpublished(
      product,
      hasUnpricedOffer,
    );
    const status = listingStatus(
      product.publicationState,
      firstOffer?.publishState ?? null,
      attentionReasons,
    );
    const productAvailability = availability(
      firstOffer?.availabilityState ?? null,
    );
    const productEvidence = evidenceSchema.safeParse(
      source?.snapshot?.evidence,
    );
    const evidenceCapturedAt = productEvidence.data?.capturedAt ?? null;
    // Product-level media (`variant_id is null`) is the cover, matching the
    // storefront read model's own ordering.
    const coverMedia =
      media.find((item) => item.variantId === null) ?? media[0];
    const supplier = supplierFacts(
      source?.evaluation?.feedSnapshot,
      productEvidence.data ?? null,
      coverMedia?.sourceUrl ?? null,
    );

    const catalogueVariants: CatalogueVariantFixture[] = variants.map(
      (variant) => {
        const providerVariant = providerVariantByVariant.get(variant.id);
        const offer = offersByVariant.get(variant.id)?.[0];
        const observedQuantity = providerVariant?.lastObservedInventory ?? null;
        const observedAt = providerVariant?.lastObservedAt ?? null;
        const bindingState = bindingsByOffer.get(offer?.id ?? '')?.[0]?.state;

        return {
          id: variant.id,
          optionLabel:
            providerVariant?.sourceOptionLabel ??
            variant.optionCombinationKey ??
            variant.sals3Sku,
          sals3VariantId: variant.id,
          sellerSku: variant.sals3Sku,
          cjVariantId: providerVariant?.externalVariantId ?? 'Not recorded',
          hasImage: media.some((item) => item.variantId === variant.id),
          sellingPrice: money(
            offer?.priceAmountMinor ?? null,
            offer?.priceCurrency ?? null,
          ),
          supplierCost:
            money(
              providerVariant?.lastObservedCostMinor ?? null,
              providerVariant?.lastObservedCostCurrency ?? null,
            ) ?? ZERO_USD,
          availability: availability(offer?.availabilityState ?? null),
          stockEvidence: stockEvidence(observedQuantity),
          supplierObservedQuantity: observedQuantity,
          lastCheckedAt: iso(observedAt ?? evidenceCapturedAt),
          evidenceFreshness: evidenceFreshness(observedAt),
          manuallyPaused:
            offer?.publishState === 'PAUSED' ||
            bindingState === ('SUSPENDED' satisfies OfferSupplierBindingState),
        };
      },
    );

    return {
      id: product.id,
      sals3ProductId: product.id,
      name: product.title,
      descriptionText: descriptionText(revision),
      hasImage: media.length > 0,
      coverImageUrl: supplier.imageUrl,
      status,
      categoryPath: categoryPath ?? 'Unmapped category',
      categoryCode,
      supplierCategoryPath: supplier.categoryPath,
      supplierCategoryId: supplier.categoryId,
      supplierSku: supplier.sku,
      supplierWeightLabel: supplier.weightLabel,
      supplierFromPrice: supplier.fromPrice,
      supplierShipsFrom: supplier.shipsFrom,
      supplierListedCount: supplier.listedCount,
      createdAt: product.createdAt.toISOString(),
      supplierProviderCode: source?.provider.code ?? 'unknown-provider',
      supplierProviderName: source?.provider.displayName ?? 'Unknown supplier',
      sourceCandidateId: reference?.sourceCandidateId ?? null,
      supplierConnectionHealth: connectionHealth(source?.connection.status),
      cjProductId: reference?.externalProductId ?? 'Not recorded',
      sellingPrice: money(
        firstOffer?.priceAmountMinor ?? null,
        firstOffer?.priceCurrency ?? null,
      ),
      availability: productAvailability,
      stockEvidence: stockEvidence(
        catalogueVariants[0]?.supplierObservedQuantity ?? null,
      ),
      supplierObservedQuantity:
        catalogueVariants.length === 0
          ? null
          : catalogueVariants.reduce<number | null>((total, variant) => {
              if (variant.supplierObservedQuantity === null) return total;

              return (total ?? 0) + variant.supplierObservedQuantity;
            }, null),
      lastCheckedAt: iso(evidenceCapturedAt),
      evidenceFreshness: evidenceFreshness(
        firstOffer?.updatedAt ?? product.updatedAt,
      ),
      mediaStatus: media.length > 0 ? 'OWN_PICTURES' : 'NEEDS_MEDIA_REVIEW',
      contentReadiness:
        descriptionText(revision).trim() === '' ? 'NEEDS_IMPROVEMENT' : 'GOOD',
      pauseReason: status === 'AUTO_PAUSED' ? 'Listing is paused.' : null,
      storefrontUrl: status === 'LIVE' ? product.slug : null,
      attentionReasons,
      editorFixtureKey: 'pass',
      editorHref: `/listings/new?productId=${product.id}`,
      productVersion: product.version,
      variants: catalogueVariants,
    };
  });
}

export async function listCatalogueProductsForSeller(
  sellerAccountId: string,
  executor: Executor = getDb(),
): Promise<CatalogueProductFixture[]> {
  return buildCatalogueProducts(await listCoreRows(executor, sellerAccountId));
}

export async function findCataloguedCandidateIds(
  sellerAccountId: string,
  candidateIds: string[],
  executor: Executor = getDb(),
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();

  const rows = await executor
    .select({ candidateId: supplierCandidates.id })
    .from(supplierCandidates)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .innerJoin(
      providerProductReferences,
      and(
        eq(
          providerProductReferences.supplierProviderId,
          supplierConnections.providerId,
        ),
        eq(
          providerProductReferences.externalProductId,
          supplierCandidates.externalProductId,
        ),
      ),
    )
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        inArray(supplierCandidates.id, candidateIds),
      ),
    );

  return new Set(rows.map((row) => row.candidateId));
}

function catalogueIssue(
  id: string,
  severity: ReadinessIssue['severity'],
  title: string,
  explanation: string,
  section: ReadinessIssue['section'],
): ReadinessIssue {
  return {
    id,
    severity,
    title,
    explanation,
    affectedScope: title,
    source: 'AUTOMATED_VALIDATION',
    section,
    reasonCode: null,
    resolution: 'Complete the missing catalogue data before publishing.',
  };
}

function editorIssues(product: CatalogueProductFixture): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  if (product.categoryPath === 'Unmapped category') {
    issues.push(
      catalogueIssue(
        `${product.id}-category`,
        'BLOCKER',
        'Sals3 category is not mapped',
        'This product has no confirmed Sals3 category in the catalogue database.',
        'specs',
      ),
    );
  }

  if (product.sellingPrice === null) {
    issues.push(
      catalogueIssue(
        `${product.id}-price`,
        'BLOCKER',
        'Selling price is not resolved',
        'At least one offer has no server-resolved selling price.',
        'variants',
      ),
    );
  }

  if (!product.hasImage) {
    issues.push(
      catalogueIssue(
        `${product.id}-media`,
        'BLOCKER',
        'No publishable media is recorded',
        'The catalogue database has no media source row for this product.',
        'media',
      ),
    );
  }

  if (product.status === 'DRAFT') {
    issues.push(
      catalogueIssue(
        `${product.id}-publication`,
        'WARNING',
        'Product is not published',
        'This row is in Product Catalogue, but the database publish state is still unpublished.',
        'review',
      ),
    );
  }

  return issues;
}

function editorVariants(product: CatalogueProductFixture): VariantFixture[] {
  if (product.variants.length === 0) {
    return [
      {
        id: `${product.id}-single`,
        optionLabel: 'Default',
        sellerSku: product.sals3ProductId,
        supplierCost: ZERO_USD,
        freightEstimate: null,
        retailPrice: product.sellingPrice ?? ZERO_USD,
        supplierStock: product.supplierObservedQuantity ?? 0,
        warehouseLabel: 'Not recorded',
        hasImage: product.hasImage,
        enabled: product.status === 'LIVE',
        listingState: product.status === 'LIVE' ? 'WILL_LIST' : 'NOT_LISTED',
        attention: product.sellingPrice === null ? 'Pricing unresolved' : null,
        supplierVariantId: product.cjProductId,
        packedWeightGrams: 0,
        evidenceCapturedAt: product.lastCheckedAt,
      },
    ];
  }

  return product.variants.map((variant) => ({
    id: variant.id,
    optionLabel: variant.optionLabel,
    sellerSku: variant.sellerSku,
    supplierCost: variant.supplierCost,
    freightEstimate: null,
    retailPrice: variant.sellingPrice ?? ZERO_USD,
    supplierStock: variant.supplierObservedQuantity ?? 0,
    warehouseLabel: 'Not recorded',
    hasImage: variant.hasImage,
    enabled: product.status === 'LIVE' && variant.availability === 'AVAILABLE',
    listingState: editorVariantListingState(product, variant),
    attention: variant.sellingPrice === null ? 'Pricing unresolved' : null,
    supplierVariantId: variant.cjVariantId,
    packedWeightGrams: 0,
    evidenceCapturedAt: variant.lastCheckedAt,
  }));
}

function editorMarkets(
  product: CatalogueProductFixture,
): MarketEvidenceFixture[] {
  return [
    {
      code: 'DB',
      name: 'Configured offer market',
      isSampleMarket: false,
      eligibility:
        product.availability === 'AVAILABLE'
          ? 'ELIGIBLE_STALE_EVIDENCE'
          : 'NO_ROUTE',
      affectedVariantsLabel: `${Math.max(product.variants.length, 1)} variant${product.variants.length === 1 ? '' : 's'}`,
      sourceWarehouse:
        product.supplierShipsFrom === undefined ||
        product.supplierShipsFrom.length === 0
          ? 'Not recorded'
          : product.supplierShipsFrom.join(', '),
      // The supplier's own packed-weight string, verbatim (it is a range, e.g.
      // "1180.00-1300.00 g"). Not parsed into a number: a freight calculation
      // must not silently pick one end of a range.
      packageWeightLabel: product.supplierWeightLabel ?? 'Not recorded',
      packageDimensionsLabel: null,
      routeEvidence:
        'No freight route evidence is stored on this catalogue row.',
      freightEstimate: null,
      deliveryRangeLabel: null,
      evidenceCapturedAt: product.lastCheckedAt,
      note: 'Catalogue read uses persisted Sals3 data only; it does not call the supplier.',
    },
  ];
}

/**
 * The attributes the database can actually answer for this product.
 *
 * The Sals3 category is the only `REQUIRED` one, because it is the only one a
 * publication gate depends on. The rest are the supplier's own facts, marked
 * `SUPPLIER` so the editor shows them as evidence rather than as something the
 * seller filled in — and omitted entirely when the row does not carry them,
 * instead of printed as an empty required field the seller cannot resolve.
 *
 * Before this, the list held one entry. Everything the Product Sourcing row had
 * already shown the seller — CJ's category, its SKU, its packed weight, where
 * it ships from — was dropped on import and never displayed again.
 */
function editorSpecifications(
  product: CatalogueProductFixture,
): SpecificationFixture[] {
  const unmapped = product.categoryPath === 'Unmapped category';
  const specifications: SpecificationFixture[] = [
    {
      key: 'category',
      label: 'Sals3 category',
      value: product.categoryPath,
      requirement: 'REQUIRED',
      // Never `SELLER`: a Sals3 category comes from an approved taxonomy
      // mapping, which is platform authority, not a seller entry.
      source: unmapped ? 'NOT_PROVIDED' : 'INFERRED',
      unresolved: unmapped,
    },
  ];

  const supplierFields: [string, string, string | null | undefined][] = [
    ['supplier_category', 'Supplier category', product.supplierCategoryPath],
    ['supplier_sku', 'Supplier SKU', product.supplierSku],
    ['packed_weight', 'Packed weight (supplier)', product.supplierWeightLabel],
    [
      'ships_from',
      'Ships from (supplier)',
      product.supplierShipsFrom === undefined ||
      product.supplierShipsFrom.length === 0
        ? null
        : product.supplierShipsFrom.join(', '),
    ],
  ];

  supplierFields.forEach(([key, label, value]) => {
    if (value === null || value === undefined || value === '') return;

    specifications.push({
      key,
      label,
      value,
      requirement: 'OPTIONAL',
      source: 'SUPPLIER',
      unresolved: false,
    });
  });

  return specifications;
}

/**
 * The product's real media rows, as editor tiles.
 *
 * This used to return a single label-only placeholder even when
 * `product_media_sources` held an address, and `MediaItemFixture` had no URL
 * field at all — so a draft with a perfectly good supplier photo rendered an
 * empty grey square. The address now travels with the tile.
 *
 * `pixelWidth`/`pixelHeight` stay `0`, honestly: no bytes are fetched anywhere
 * in this path, so no dimensions exist. `storageState` is
 * `SUPPLIER_HOSTED_SOURCE` because that is literally where the file lives —
 * nothing in this repository copies supplier media into Sals3-controlled
 * storage, and no label here may imply that it has.
 *
 * `rightsCheck` follows `mediaStatus`, which is `OWN_PICTURES` only when a
 * `product_media_sources` row exists. An address shown from the discovery
 * snapshot alone is `PENDING_VERIFICATION` and says so: it is a preview of what
 * the seller sourced, not a publishable asset with a recorded basis (ADR-011
 * §6).
 */
function editorMedia(product: CatalogueProductFixture): MediaItemFixture[] {
  if (product.coverImageUrl === null || product.coverImageUrl === undefined) {
    return [];
  }

  return [
    {
      id: `${product.id}-media`,
      label: 'Supplier photo',
      sourceUrl: product.coverImageUrl,
      altText: `Supplier listing photo for ${product.name}`,
      rightsCheck:
        product.mediaStatus === 'OWN_PICTURES'
          ? 'VERIFIED'
          : 'PENDING_VERIFICATION',
      storageState: 'SUPPLIER_HOSTED_SOURCE',
      pixelWidth: 0,
      pixelHeight: 0,
      note:
        product.mediaStatus === 'OWN_PICTURES'
          ? 'Supplier-hosted address with a recorded rights basis. Sals3 holds no copy of the file, so its dimensions are unknown.'
          : 'Shown from the stored discovery snapshot. No media provenance row exists for it yet, so it is not publishable.',
      isCover: true,
    },
  ];
}

export function productToEditorFixture(product: CatalogueProductFixture): {
  fixture: ProductEditorFixture;
  variantGuidance: VariantPricingGuidance[];
} {
  const variants = editorVariants(product);
  const issues = editorIssues(product);
  const fixture: ProductEditorFixture = {
    fixtureKey: product.id,
    scenarioLabel: `Database product - ${product.status}`,
    productName: product.name,
    supplierProductName: product.name,
    // CJ's own category name, not the Sals3 one. These were the same value
    // until 2026-08-14, which made the supplier evidence block report
    // "Unmapped category" as if the supplier had said it.
    supplierCategoryPath: product.supplierCategoryPath ?? 'Not recorded',
    sals3CategoryPath: product.categoryPath,
    sals3CategoryCode: product.categoryCode ?? null,
    categoryMappingConfidence:
      product.categoryPath === 'Unmapped category' ? 'UNMAPPED' : 'ACCEPTABLE',
    realSupplierCandidateId: product.sourceCandidateId ?? null,
    sellerSku: variants[0]?.sellerSku ?? product.sals3ProductId,
    brandDeclaration: 'No brand / generic',
    descriptionText: product.descriptionText ?? '',
    source: {
      providerId: product.supplierProviderCode,
      providerCode: product.supplierProviderCode,
      providerDisplayName: product.supplierProviderName,
      providerLogoPath:
        product.supplierProviderCode === 'CJ_DROPSHIPPING'
          ? '/suppliers/cj-dropshipping-logo-white.svg'
          : undefined,
      connectionId: product.supplierConnectionHealth,
      connectionDisplayName: product.supplierConnectionHealth,
      connectionStatus: editorConnectionStatus(
        product.supplierConnectionHealth,
      ),
      externalProductId: product.cjProductId,
      sourceCurrency: product.sellingPrice?.currency ?? USD,
      lastSuccessfulSyncAt: product.lastCheckedAt,
      lastAttemptedSyncAt: product.lastCheckedAt,
    },
    evaluationStatus: issues.some((issue) => issue.severity === 'BLOCKER')
      ? 'BLOCKED'
      : 'PASS',
    listingState: editorListingState(product),
    completionPercent: Math.max(10, 100 - issues.length * 20),
    lastValidatedAt: product.lastCheckedAt,
    sourceProductStatus: 'LISTED_BY_SUPPLIER',
    banner:
      product.status === 'DRAFT'
        ? {
            tone: 'warning',
            title: 'This catalogue product is not live yet',
            body: 'The database record exists, but publication gates have not made it sellable.',
          }
        : null,
    issues,
    sourceChanges: [],
    specifications: editorSpecifications(product),
    variants,
    markets: editorMarkets(product),
    marketsNotEnabledCount: 0,
    media: editorMedia(product),
    policyVersion: 'database',
    advancedIdentifiers: {
      product_id: product.id,
      sals3_product_id: product.sals3ProductId,
      external_product_id: product.cjProductId,
    },
  };

  return {
    fixture,
    /**
     * `decision: null` — "the resolver did not run here" — rather than a
     * hard-coded `CATEGORY_MAPPING_REQUIRES_REVIEW`.
     *
     * This read model makes no pricing decision, and stating one would be a
     * second pricing opinion that can disagree with ADR-015's resolver. It did:
     * once draft creation started resolving categories through the approved
     * crosswalk, a mapped product still reported "category mapping requires
     * review" from this line, when the real refusal is a missing category
     * policy. `/listings/new` calls `resolveFixtureVariantGuidance` for the
     * real answer.
     */
    variantGuidance: variants.map((variant) => ({
      variantId: variant.id,
      optionLabel: variant.optionLabel,
      decision: null,
    })),
  };
}

export async function findProductEditorFixtureForSeller(
  sellerAccountId: string,
  productId: string,
  executor: Executor = getDb(),
): Promise<ReturnType<typeof productToEditorFixture> | null> {
  const productsForSeller = await listCatalogueProductsForSeller(
    sellerAccountId,
    executor,
  );
  const product = productsForSeller.find((row) => row.id === productId);

  return product === undefined ? null : productToEditorFixture(product);
}
