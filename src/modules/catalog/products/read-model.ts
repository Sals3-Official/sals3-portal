import 'server-only';

import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';

import getDb, { type Database } from '@/lib/db/client';
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
  capturedAt: z.string().nullish(),
  variants: z.array(evidenceVariantSchema).default([]),
});

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
      status,
      categoryPath: categoryPath ?? 'Unmapped category',
      categoryCode,
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
      sourceWarehouse: 'Not recorded',
      packageWeightLabel: 'Not recorded',
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

function editorMedia(product: CatalogueProductFixture): MediaItemFixture[] {
  if (!product.hasImage) return [];

  return [
    {
      id: `${product.id}-media`,
      label: 'Recorded media source',
      rightsCheck: 'PENDING_VERIFICATION',
      storageState: 'STORAGE_STATUS_UNAVAILABLE',
      pixelWidth: 0,
      pixelHeight: 0,
      note: 'Media provenance row exists, but dimensions are not rendered in this read model yet.',
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
    supplierCategoryPath: product.categoryPath,
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
    specifications: [
      {
        key: 'category',
        label: 'Category',
        value: product.categoryPath,
        requirement: 'REQUIRED',
        source:
          product.categoryPath === 'Unmapped category'
            ? 'NOT_PROVIDED'
            : 'SELLER',
        unresolved: product.categoryPath === 'Unmapped category',
      },
    ] satisfies SpecificationFixture[],
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
    variantGuidance: variants.map((variant) => ({
      variantId: variant.id,
      optionLabel: variant.optionLabel,
      decision: {
        outcome: 'PRICING_UNAVAILABLE',
        reason: 'CATEGORY_MAPPING_REQUIRES_REVIEW',
        reasonLabel: 'Category mapping requires review',
        resolverVersion: 'pricing-resolver-v1',
      },
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
