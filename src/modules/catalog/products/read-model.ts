import 'server-only';

import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { z } from 'zod';

import getDb, { type Database } from '@/lib/db/client';
import { cjImageUrl } from '@/lib/cj/primitives';
import { r2PublicImageUrl } from '@/lib/storage/r2-url';
import {
  ACTIVE_TAXONOMY_VERSION,
  candidateEvaluations,
  categoryAttributeControls,
  offerSupplierBindings,
  productCategoryAttributeValues,
  productMediaSources,
  productOffers,
  productOptionValues,
  productOptions,
  productRevisions,
  productVariantOptionValues,
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  sals3CategoryPresets,
  sals3Categories,
  supplierCandidates,
  supplierConnections,
  supplierProviders,
  supplierSnapshots,
  type OfferPublishState,
  type OfferSupplierBindingState,
  type ProductMediaSourceRow,
  type ProductPublicationState,
  type ProductRevisionRow,
  type ProductRow,
} from '@/lib/db/schema';
import { ACTIVE_ATTRIBUTE_CONTROLS_VERSION } from '@/lib/db/schema/category-attribute-controls';
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
  CategoryAttributeFieldFixture,
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
import type { CategoryAttributeContract } from '@/modules/catalog/taxonomy/attribute-types';
import { validateCategoryAttributeSubmission } from '@/modules/catalog/taxonomy/attribute-contract';
import { descriptionDocumentSchema } from './description-document';
import { deriveOptionSplit } from './option-split';
import { deriveSourceChanges } from './source-changes';

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
  /** See `CandidateEvidence.packedDimensionsLabel`'s doc comment (`lib/cj/evidence.ts`). */
  packedDimensionsLabel: z.string().nullish(),
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
  name: string | null;
  categoryPath: string | null;
  categoryId: string | null;
  sku: string | null;
  weightLabel: string | null;
  /** Only ever available from the richer detail-evidence snapshot — the cheap feed has no equivalent. */
  packedDimensionsLabel: string | null;
  fromPrice: MoneyValue | null;
  shipsFrom: string[];
  listedCount: number | null;
  imageUrl: string | null;
};

const NO_SUPPLIER_FACTS: SupplierFacts = {
  name: null,
  categoryPath: null,
  categoryId: null,
  sku: null,
  weightLabel: null,
  packedDimensionsLabel: null,
  fromPrice: null,
  shipsFrom: [],
  listedCount: null,
  imageUrl: null,
};

/**
 * Re-checks a stored image address against the right host allow-list on the
 * way out of the database - CJ's for supplier evidence (the default, since
 * every call site but `productImageUrls` is always supplier-origin), Vercel
 * Blob's for a real `SELLER_UPLOAD` row.
 *
 * Not redundant with the check at intake: `feed_snapshot.imageUrl` is a plain
 * string column, `next.config.ts` sets `images.loader: 'custom'` so
 * `remotePatterns` enforces nothing at request time, and whatever string
 * reaches a rendered `src` becomes a browser `GET` from the seller's own
 * session. Same reasoning, and the same `cjImageUrl` gate, as
 * `components/products/cj/candidate-view.ts`'s `imageUrl()` on the pipeline
 * read path.
 */
function allowedImageUrl(
  value: unknown,
  sourceType: ProductMediaSourceRow['sourceType'] = 'SUPPLIER_ORIGINAL',
): string | null {
  const parsed =
    sourceType === 'SELLER_UPLOAD'
      ? r2PublicImageUrl.safeParse(value)
      : cjImageUrl.safeParse(value);

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
    // The raw name discovery captured from the supplier feed at intake time
    // - never the seller-editable Product Name, and never re-fetched, so it
    // stays exactly what the supplier called it even after the seller
    // rewrites their own copy.
    name: feed.data.name,
    // Evidence first: a product-detail fetch is more specific than the
    // list-level summary discovery wrote.
    categoryPath: evidence?.categoryName ?? feed.data.category ?? null,
    categoryId: feed.data.categoryId ?? null,
    sku: feed.data.sku ?? null,
    weightLabel: feed.data.weight ?? null,
    packedDimensionsLabel: evidence?.packedDimensionsLabel ?? null,
    fromPrice: cents === null ? null : { amountMinor: cents, currency: USD },
    shipsFrom: feed.data.shipsFrom,
    listedCount: feed.data.listedCount,
    // A recorded media row outranks the feed field: it is the address that
    // carries a rights basis and an observation time.
    imageUrl: allowedImageUrl(mediaUrl) ?? allowedImageUrl(feed.data.imageUrl),
  };
}

function productImageUrls(media: ProductMediaSourceRow[]): string[] {
  const urls = media
    .map((item) => allowedImageUrl(item.sourceUrl, item.sourceType))
    .filter((url): url is string => url !== null);

  return [...new Set(urls)];
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

/**
 * A timestamp only if it is one a formatter can survive.
 *
 * `evidence.capturedAt` is `z.string().nullish()` — any string satisfies it,
 * because the schema mirrors what the capture path writes rather than policing
 * it. Downstream, `formatDateTime` calls `Intl.DateTimeFormat().format(new
 * Date(value))`, and `Intl` **throws a RangeError on an invalid date** rather
 * than printing something odd. One malformed snapshot would take the whole
 * Changes tab down with it.
 *
 * Returning `null` for anything unparseable turns that crash into the panel's
 * existing "no evidence stored" wording, which is the honest reading: a
 * timestamp nobody can interpret is not a date this can claim to compare against.
 */
function displayableTimestamp(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;

  return Number.isNaN(new Date(value).getTime()) ? null : value;
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

function variantOrderKey(variant: CatalogueVariantFixture): string {
  if (variant.mappedOptions !== undefined && variant.mappedOptions.length > 0) {
    return [...variant.mappedOptions]
      .sort((left, right) => left.optionPosition - right.optionPosition)
      .map(
        (option) =>
          `${option.optionPosition.toString().padStart(4, '0')}:${option.valuePosition.toString().padStart(4, '0')}:${option.optionValue}`,
      )
      .join('|');
  }

  return `zzzz:${variant.optionLabel}`;
}

function compareCatalogueVariants(
  left: CatalogueVariantFixture,
  right: CatalogueVariantFixture,
): number {
  const byOptions = variantOrderKey(left).localeCompare(variantOrderKey(right));

  if (byOptions !== 0) return byOptions;

  return left.sellerSku.localeCompare(right.sellerSku);
}

function mappedOptionLabel(
  mappedOptions: NonNullable<CatalogueVariantFixture['mappedOptions']>,
  fallback: string,
): string {
  if (mappedOptions.length === 0) return fallback;

  return [...mappedOptions]
    .sort((left, right) => left.optionPosition - right.optionPosition)
    .map((option) => `${option.optionName}: ${option.optionValue}`)
    .join(', ');
}

function presetVariationAttributes(
  preset:
    | {
        tier1Attribute: string | null;
        tier2Attribute: string | null;
      }
    | undefined,
): CatalogueProductFixture['categoryPresetVariationAttributes'] {
  if (preset === undefined) return undefined;

  return [preset.tier1Attribute, preset.tier2Attribute];
}

function suggestedOptionAxisNames(
  proposal: { index: number }[],
  presetAttributes:
    CatalogueProductFixture['categoryPresetVariationAttributes'] | undefined,
): string[] {
  if (presetAttributes === undefined || proposal.length === 0) return [];

  const names = proposal.map((axis) => presetAttributes[axis.index]?.trim());

  return names.every(
    (name): name is string => name !== undefined && name !== '',
  )
    ? names
    : [];
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
      categoryL1: sals3Categories.l1,
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
      optionRows: [],
      presetRows: [],
      attributeControlRows: [],
      attributeValueRows: [],
      variantOptionRows: [],
      providerVariantRows: [],
      offerRows: [],
      bindingRows: [],
      revisionRows: [],
      mediaRows: [],
      sourceRows: [],
    };
  }

  const categoryIds = [
    ...new Set(
      productRows
        .map((row) => row.product.categoryId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [
    variantRows,
    referenceRows,
    revisionRows,
    mediaRows,
    optionRows,
    presetRows,
    attributeControlRows,
    attributeValueRows,
  ] = await Promise.all([
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
      .where(inArray(productMediaSources.productId, ids))
      .orderBy(
        asc(productMediaSources.productId),
        asc(productMediaSources.createdAt),
      ),
    // Whether a seller has already named this product's option axes. Ordered
    // by the stored position, which is the order they chose, not
    // `normalized_name` — `Colour × Size` must not resurface as `Size ×
    // Colour`.
    executor
      .select({
        productId: productOptions.productId,
        position: productOptions.position,
        name: productOptions.name,
      })
      .from(productOptions)
      .where(inArray(productOptions.productId, ids))
      .orderBy(asc(productOptions.productId), asc(productOptions.position)),
    categoryIds.length === 0
      ? Promise.resolve([])
      : executor
          .select({
            categoryId: sals3CategoryPresets.categoryId,
            tier1Attribute: sals3CategoryPresets.tier1Attribute,
            tier2Attribute: sals3CategoryPresets.tier2Attribute,
          })
          .from(sals3CategoryPresets)
          .where(
            and(
              inArray(sals3CategoryPresets.categoryId, categoryIds),
              eq(sals3CategoryPresets.taxonomyVersion, ACTIVE_TAXONOMY_VERSION),
            ),
          ),
    categoryIds.length === 0
      ? Promise.resolve([])
      : executor
          .select()
          .from(categoryAttributeControls)
          .where(
            and(
              inArray(categoryAttributeControls.categoryId, categoryIds),
              eq(
                categoryAttributeControls.controlsVersion,
                ACTIVE_ATTRIBUTE_CONTROLS_VERSION,
              ),
            ),
          ),
    executor
      .select()
      .from(productCategoryAttributeValues)
      .where(inArray(productCategoryAttributeValues.productId, ids)),
  ]);

  const variantIds = variantRows.map((row) => row.id);
  const referenceIds = referenceRows.map((row) => row.id);
  const sourceCandidateIds = referenceRows
    .map((row) => row.sourceCandidateId)
    .filter((id): id is string => id !== null);

  const [providerVariantRows, offerRows, sourceRows, variantOptionRows] =
    await Promise.all([
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
              eq(
                supplierConnections.id,
                supplierCandidates.supplierConnectionId,
              ),
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
      variantIds.length === 0
        ? Promise.resolve([])
        : executor
            .select({
              variantId: productVariantOptionValues.variantId,
              optionName: productOptions.name,
              optionPosition: productOptions.position,
              optionValue: productOptionValues.label,
              valuePosition: productOptionValues.position,
            })
            .from(productVariantOptionValues)
            .innerJoin(
              productOptions,
              eq(productOptions.id, productVariantOptionValues.optionId),
            )
            .innerJoin(
              productOptionValues,
              eq(
                productOptionValues.id,
                productVariantOptionValues.optionValueId,
              ),
            )
            .where(inArray(productVariantOptionValues.variantId, variantIds))
            .orderBy(
              asc(productVariantOptionValues.variantId),
              asc(productOptions.position),
              asc(productOptionValues.position),
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
    optionRows,
    presetRows,
    attributeControlRows,
    attributeValueRows,
    variantOptionRows,
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
  const optionsByProduct = groupBy(
    rows.optionRows,
    (option) => option.productId,
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
  const optionValuesByVariant = groupBy(
    rows.variantOptionRows,
    (option) => option.variantId,
  );
  const presetByCategory = new Map(
    rows.presetRows.map((preset) => [preset.categoryId, preset]),
  );
  const attributeControlsByCategory = groupBy(
    rows.attributeControlRows,
    (control) => control.categoryId,
  );
  const attributeValuesByProduct = groupBy(
    rows.attributeValueRows,
    (value) => value.productId,
  );

  return rows.productRows.map(
    ({ product, categoryPath, categoryCode, categoryL1 }) => {
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
      const imageUrls = productImageUrls(media);
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
      const mediaImageUrls =
        imageUrls.length === 0 && supplier.imageUrl !== null
          ? [supplier.imageUrl]
          : imageUrls;

      // Kept apart from `mediaImageUrls` above for the editor's Supplier
      // Details / Media split (ADR-011): a supplier's own photo is
      // provenance, never something a seller can reorder or pick a cover
      // from, while a `SELLER_UPLOAD` row is the seller's own and belongs in
      // the editable Media section. The bare feed `imageUrl` fallback is
      // still supplier-origin even with no `product_media_sources` row yet.
      const recordedSupplierImageUrls = productImageUrls(
        media.filter((item) => item.sourceType === 'SUPPLIER_ORIGINAL'),
      );
      const supplierMediaUrls =
        recordedSupplierImageUrls.length === 0 && supplier.imageUrl !== null
          ? [supplier.imageUrl]
          : recordedSupplierImageUrls;
      const sellerMediaUrls = productImageUrls(
        media.filter((item) => item.sourceType === 'SELLER_UPLOAD'),
      );

      const catalogueVariants: CatalogueVariantFixture[] = variants
        .map((variant) => {
          const providerVariant = providerVariantByVariant.get(variant.id);
          const offer = offersByVariant.get(variant.id)?.[0];
          const observedQuantity =
            providerVariant?.lastObservedInventory ?? null;
          const observedAt = providerVariant?.lastObservedAt ?? null;
          const bindingState = bindingsByOffer.get(offer?.id ?? '')?.[0]?.state;
          const fallbackOptionLabel =
            providerVariant?.sourceOptionLabel ??
            variant.optionCombinationKey ??
            variant.sals3Sku;
          const mappedOptions = [
            ...(optionValuesByVariant.get(variant.id) ?? []),
          ]
            .sort(
              (left, right) =>
                left.optionPosition - right.optionPosition ||
                left.valuePosition - right.valuePosition,
            )
            .map((option) => ({
              optionName: option.optionName,
              optionValue: option.optionValue,
              optionPosition: option.optionPosition,
              valuePosition: option.valuePosition,
            }));

          return {
            id: variant.id,
            optionLabel: mappedOptionLabel(mappedOptions, fallbackOptionLabel),
            // No fallback: the option split is derived from this, and a
            // stand-in would be split into axes the supplier never sent.
            supplierOptionLabel: providerVariant?.sourceOptionLabel ?? null,
            mappedOptions,
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
              bindingState ===
                ('SUSPENDED' satisfies OfferSupplierBindingState),
          };
        })
        .sort(compareCatalogueVariants);

      return {
        id: product.id,
        sals3ProductId: product.id,
        name: product.title,
        descriptionText: descriptionText(revision),
        metaDescriptionText: product.metaDescription ?? '',
        hasImage: mediaImageUrls.length > 0,
        coverImageUrl: supplier.imageUrl,
        mediaImageUrls,
        supplierMediaUrls,
        sellerMediaUrls,
        status,
        // The CJ category is the Sals3 category (owner decision 2026-08-14):
        // a row not yet carrying a mapped category shows the supplier's own
        // category, which is exactly what publication will categorise it as.
        // 'Unmapped category' survives only for a row with no CJ category at
        // all — the one case that still blocks.
        categoryPath:
          categoryPath ?? supplier.categoryPath ?? 'Unmapped category',
        categoryCode,
        categoryMappingId: product.categoryMappingId,
        sals3CategoryL1: product.sals3CategoryL1 ?? categoryL1 ?? null,
        supplierProductName: supplier.name,
        supplierCategoryPath: supplier.categoryPath,
        supplierCategoryId: supplier.categoryId,
        supplierSku: supplier.sku,
        supplierWeightLabel: supplier.weightLabel,
        supplierPackedDimensionsLabel: supplier.packedDimensionsLabel,
        supplierFromPrice: supplier.fromPrice,
        supplierShipsFrom: supplier.shipsFrom,
        supplierListedCount: supplier.listedCount,
        createdAt: product.createdAt.toISOString(),
        supplierProviderCode: source?.provider.code ?? 'unknown-provider',
        supplierProviderName:
          source?.provider.displayName ?? 'Unknown supplier',
        sourceCandidateId: reference?.sourceCandidateId ?? null,
        // Parsed above for the product facts already, so carrying it costs
        // nothing and the change diff needs no query of its own.
        supplierEvidence: {
          capturedAt: displayableTimestamp(evidenceCapturedAt),
          variants: (productEvidence.data?.variants ?? []).map((variant) => ({
            vid: variant.vid,
            optionLabel: variant.optionLabel ?? null,
            priceUsd: variant.priceUsd ?? null,
            totalInventory: variant.totalInventory ?? null,
          })),
        },
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
          descriptionText(revision).trim() === ''
            ? 'NEEDS_IMPROVEMENT'
            : 'GOOD',
        pauseReason: status === 'AUTO_PAUSED' ? 'Listing is paused.' : null,
        storefrontUrl: status === 'LIVE' ? product.slug : null,
        attentionReasons,
        editorFixtureKey: 'pass',
        editorHref: `/listings/new?productId=${product.id}`,
        productVersion: product.version,
        currentRevisionId: revision?.id ?? null,
        currentRevisionVersion: revision?.version ?? null,
        optionAxisNames: (optionsByProduct.get(product.id) ?? []).map(
          (option) => option.name,
        ),
        categoryPresetVariationAttributes: presetVariationAttributes(
          product.categoryId === null
            ? undefined
            : presetByCategory.get(product.categoryId),
        ),
        categoryAttributeControls: (
          (product.categoryId === null
            ? undefined
            : attributeControlsByCategory.get(product.categoryId)) ?? []
        ).map((control) => ({
          attributeName: control.attributeName,
          requirementLevel: control.requirementLevel,
          inputControlType: control.inputControlType,
          allowedValues: control.allowedValues,
          allowCustomValue: control.allowCustomValue,
          allowMultipleValues: control.allowMultipleValues,
          sellerHelpText: control.sellerHelpText,
          seoVisibility: control.seoVisibility,
          aeoGeoVisibility: control.aeoGeoVisibility,
        })),
        categoryAttributeControlsVersion:
          product.categoryId !== null &&
          (attributeControlsByCategory.get(product.categoryId)?.length ?? 0) > 0
            ? ACTIVE_ATTRIBUTE_CONTROLS_VERSION
            : undefined,
        categoryAttributeControlsSource: (() => {
          const first =
            product.categoryId === null
              ? undefined
              : attributeControlsByCategory.get(product.categoryId)?.[0];

          return first === undefined
            ? undefined
            : {
                workbook: first.sourceWorkbook,
                sheet: first.sourceSheet,
                checksum: first.sourceChecksum,
              };
        })(),
        categoryAttributeValues: (
          attributeValuesByProduct.get(product.id) ?? []
        ).map((row) => ({
          attributeName: row.attributeName,
          values: row.values,
          isCustomValue: row.isCustomValue,
        })),
        variants: catalogueVariants,
      };
    },
  );
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

/**
 * The category this product will actually be published under: the mapped
 * Sals3 category when one is recorded, otherwise the supplier's own category
 * — which IS the Sals3 category since the 2026-08-14 owner decision, applied
 * server-side at draft creation and publication through the CJ mirror. The
 * sentinel survives only when the row has no CJ category anywhere.
 */
function effectiveCategoryPath(product: CatalogueProductFixture): string {
  if (product.categoryPath !== 'Unmapped category') return product.categoryPath;

  return product.supplierCategoryPath ?? 'Unmapped category';
}

function effectiveSals3CategoryL1(
  product: CatalogueProductFixture,
): string | null {
  return product.sals3CategoryL1 ?? null;
}

/**
 * True only when this product's own category came from a seller explicitly
 * deciding it (`decideProductSals3Category`), not from the CJ auto-mirror or
 * a reviewed crosswalk decision (`ensureCjCategoryMirror`,
 * `applyResolvedCategoryToProduct`) — both of those always leave
 * `categoryMappingId` pointing at the `provider_category_mappings` row that
 * produced them. A seller's own decision writes a category with no such row
 * behind it (see `taxonomy/repository.ts`'s `assignProductCategory`), which
 * is the only reliable signal here: `categoryMappingConfidence` alone cannot
 * distinguish the two, since the mirror also resolves `EXACT`.
 */
function sellerDeclaredSals3Category(
  product: CatalogueProductFixture,
): boolean {
  return (
    product.categoryCode !== null &&
    product.categoryCode !== undefined &&
    (product.categoryMappingId ?? null) === null
  );
}

function editorIssues(product: CatalogueProductFixture): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  // Only a product with no CJ category anywhere — no mapped category AND no
  // supplier category on record — is blocked. When the supplier category
  // exists, it IS the category (owner decision 2026-08-14), and publication
  // applies it server-side.
  if (effectiveCategoryPath(product) === 'Unmapped category') {
    issues.push(
      catalogueIssue(
        `${product.id}-category`,
        'BLOCKER',
        'CJ category is missing',
        'No CJ category was captured for this product, so it cannot be categorised.',
        'specs',
      ),
    );
  }

  if (product.sellingPrice === null) {
    issues.push(
      catalogueIssue(
        `${product.id}-price`,
        'BLOCKER',
        'Retail price is required',
        'Enter a retail price greater than zero for every variant.',
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
        'basic',
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

/**
 * Category-driven attribute controls, already joined with whatever the
 * seller has stored (the Specification section) - distinct from
 * `editorSpecifications` above, the unrelated read-only Supplier Details
 * tab.
 *
 * A category with no attribute controls for the active
 * `ACTIVE_ATTRIBUTE_CONTROLS_VERSION` yet returns no fields and no issues -
 * that is not an error, it means the workbook has nothing to say about this
 * category yet, not that everything is required.
 *
 * Delegates every rule about what counts as valid to
 * `validateCategoryAttributeSubmission` (`taxonomy/attribute-contract.ts`) -
 * this function only assembles the contract-shaped object from the
 * already-batched fixture data (no query of its own) and turns the
 * validation result into display fields and `ReadinessIssue`s.
 */
function editorCategoryAttributes(product: CatalogueProductFixture): {
  fields: CategoryAttributeFieldFixture[];
  issues: ReadinessIssue[];
} {
  const controls = product.categoryAttributeControls ?? [];

  if (
    controls.length === 0 ||
    product.categoryAttributeControlsVersion === undefined ||
    product.categoryAttributeControlsSource === undefined ||
    product.categoryCode === null ||
    product.categoryCode === undefined
  ) {
    return { fields: [], issues: [] };
  }

  const contract: Extract<
    CategoryAttributeContract,
    { outcome: 'CATEGORY_ATTRIBUTE_CONTRACT' }
  > = {
    outcome: 'CATEGORY_ATTRIBUTE_CONTRACT',
    categoryCode: product.categoryCode,
    categoryPath: product.categoryPath,
    controlsVersion: product.categoryAttributeControlsVersion,
    controls,
    source: product.categoryAttributeControlsSource,
    contractVersion: 'category-attribute-contract-v1',
  };

  const payload = Object.fromEntries(
    (product.categoryAttributeValues ?? []).map((value) => [
      value.attributeName,
      [...value.values],
    ]),
  );

  const validation = validateCategoryAttributeSubmission(contract, payload);

  const fields: CategoryAttributeFieldFixture[] = controls.map((control) => {
    const accepted = validation.acceptedAttributes[control.attributeName];
    const unresolved =
      accepted === undefined && control.requirementLevel !== 'OPTIONAL';

    return {
      attributeName: control.attributeName,
      requirement: control.requirementLevel,
      inputControlType: control.inputControlType,
      allowedValues: control.allowedValues,
      allowCustomValue: control.allowCustomValue,
      allowMultipleValues: control.allowMultipleValues,
      sellerHelpText: control.sellerHelpText,
      values: accepted?.values ?? [],
      isCustomValue: accepted?.isCustomValue ?? false,
      unresolved,
    };
  });

  const issues: ReadinessIssue[] = [
    ...validation.missingRequiredAttributes.map((name) =>
      catalogueIssue(
        `${product.id}-specification-${name}`,
        'BLOCKER',
        `${name} is required`,
        `This category requires a value for "${name}" before publishing.`,
        'specification',
      ),
    ),
    ...validation.missingRecommendedAttributes.map((name) =>
      catalogueIssue(
        `${product.id}-specification-${name}`,
        'WARNING',
        `${name} is recommended`,
        `This category recommends a value for "${name}".`,
        'specification',
      ),
    ),
  ];

  return { fields, issues };
}

function editorVariants(product: CatalogueProductFixture): VariantFixture[] {
  if (product.variants.length === 0) {
    const supplierStock = product.supplierObservedQuantity ?? 0;
    // A newly-drafted product has no listing decision to inherit, so every
    // eligible variant defaults to listing rather than starting the seller
    // at zero — the same "in stock, not paused" bar the bulk enable action
    // already uses (`canBulkEnable`), not `product.status === 'LIVE'`, which
    // only ever describes a product that already published.
    let listingState: VariantFixture['listingState'] = 'NOT_LISTED';

    if (product.status === 'AUTO_PAUSED') {
      listingState = 'PAUSED';
    } else if (supplierStock > 0) {
      listingState = 'WILL_LIST';
    }

    return [
      {
        id: `${product.id}-single`,
        optionLabel: 'Default',
        sellerSku: product.sals3ProductId,
        supplierCost: ZERO_USD,
        retailPrice: product.sellingPrice ?? ZERO_USD,
        supplierStock,
        warehouseLabel: 'Not recorded',
        hasImage: product.hasImage,
        enabled: listingState === 'WILL_LIST',
        listingState,
        attention:
          product.sellingPrice === null ? 'Retail price required' : null,
        supplierVariantId: product.cjProductId,
        packedWeightGrams: 0,
        evidenceCapturedAt: product.lastCheckedAt,
      },
    ];
  }

  return [...product.variants].sort(compareCatalogueVariants).map((variant) => {
    const listingState = editorVariantListingState(product, variant);

    return {
      id: variant.id,
      optionLabel: variant.optionLabel,
      sellerSku: variant.sellerSku,
      supplierCost: variant.supplierCost,
      retailPrice: variant.sellingPrice ?? ZERO_USD,
      supplierStock: variant.supplierObservedQuantity ?? 0,
      warehouseLabel: 'Not recorded',
      hasImage: variant.hasImage,
      // Same reasoning as the single-variant case above: eligibility
      // (in stock, not paused) decides the default, not whether the
      // product happens to be published yet.
      enabled: listingState === 'WILL_LIST',
      listingState,
      attention: variant.sellingPrice === null ? 'Retail price required' : null,
      supplierVariantId: variant.cjVariantId,
      packedWeightGrams: 0,
      evidenceCapturedAt: variant.lastCheckedAt,
    };
  });
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
      packageWeightLabel: product.supplierWeightLabel ?? 'Not recorded',
      evidenceCapturedAt: product.lastCheckedAt,
      note: 'Catalogue read uses persisted Sals3 data only; it does not call the supplier.',
    },
  ];
}

/**
 * The attributes the database can actually answer for this product.
 *
 * The CJ Category is the only `REQUIRED` one, because it is the only one a
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
  // CJ's own catalogue category, verbatim, never the resolved/curated one:
  // order fulfillment relies on this field staying exactly what the supplier
  // sent. `effectiveCategoryPath` follows `products.categoryId`, which a
  // curated Sals3 mapping (2026-08-15 reversal of the 2026-08-14 mirror
  // decision) now updates independently — reading it here would let a
  // curated category silently replace what this field promises to show.
  const { supplierCategoryPath } = product;
  const unmapped =
    supplierCategoryPath === null || supplierCategoryPath === undefined;
  const specifications: SpecificationFixture[] = [
    {
      key: 'category',
      label: 'CJ Category',
      value: supplierCategoryPath ?? 'Unmapped category',
      requirement: 'REQUIRED',
      // Never `SELLER`: the category is the supplier's own catalogue
      // category, not a seller entry.
      source: unmapped ? 'NOT_PROVIDED' : 'SUPPLIER',
      unresolved: unmapped,
    },
  ];

  // The resolved/curated Sals3 category — from a reviewed mapping or, absent
  // one, the CJ auto-mirror. Shown only when it diverges from CJ Category
  // above, so a seller can see the two are decided separately without the
  // common case (mirror, not yet curated) repeating the same text twice.
  const curatedCategoryPath = effectiveCategoryPath(product);

  if (curatedCategoryPath !== (supplierCategoryPath ?? 'Unmapped category')) {
    specifications.push({
      key: 'sals3_category',
      label: 'Sals3 Category (curated)',
      value: curatedCategoryPath,
      requirement: 'OPTIONAL',
      source: 'INFERRED',
      unresolved: false,
    });
  }

  const supplierFields: [string, string, string | null | undefined][] = [
    ['supplier_sku', 'Supplier SKU', product.supplierSku],
    ['packed_weight', 'Packed weight (supplier)', product.supplierWeightLabel],
    [
      'packed_dimensions',
      'Package dimensions (supplier)',
      product.supplierPackedDimensionsLabel,
    ],
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
 * The supplier's own photos (ADR-011), as read-only editor tiles for Supplier
 * Details.
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
 * §6). These are provenance, not the seller's to change — `isCover` marks the
 * storefront's current fallback pick for display only, never a control this
 * evidence exposes.
 */
function editorSupplierMedia(
  product: CatalogueProductFixture,
): MediaItemFixture[] {
  const imageUrls = product.supplierMediaUrls ?? [];

  if (imageUrls.length === 0) return [];

  return imageUrls.map((imageUrl, index) => ({
    id: `${product.id}-supplier-media-${index + 1}`,
    label: `Supplier photo ${index + 1}`,
    sourceUrl: imageUrl,
    altText: `Supplier listing photo for ${product.name}`,
    rightsCheck:
      product.mediaStatus === 'OWN_PICTURES'
        ? 'VERIFIED'
        : 'PENDING_VERIFICATION',
    storageState: 'SUPPLIER_HOSTED_SOURCE',
    sourceType: 'SUPPLIER_ORIGINAL',
    pixelWidth: 0,
    pixelHeight: 0,
    note:
      product.mediaStatus === 'OWN_PICTURES'
        ? 'Supplier-hosted address with a recorded rights basis. Sals3 holds no copy of the file, so its dimensions are unknown.'
        : 'Shown from the stored discovery snapshot. No media provenance row exists for it yet, so it is not publishable.',
    isCover: index === 0,
  }));
}

/**
 * The seller's own uploaded photos only (ADR-011) - the sole rows Media
 * section's reorder/cover/replace controls may touch. Empty on every real
 * product today: no upload path exists yet to write a `SELLER_UPLOAD` row,
 * so this is honestly `[]` rather than borrowing the supplier's picture.
 */
function editorSellerMedia(
  product: CatalogueProductFixture,
): MediaItemFixture[] {
  const imageUrls = product.sellerMediaUrls ?? [];

  return imageUrls.map((imageUrl, index) => ({
    id: `${product.id}-seller-media-${index + 1}`,
    label: `Photo ${index + 1}`,
    sourceUrl: imageUrl,
    altText: `Seller-uploaded photo for ${product.name}`,
    rightsCheck: 'VERIFIED',
    storageState: 'SALS3_STORED',
    sourceType: 'SELLER_UPLOAD',
    pixelWidth: 0,
    pixelHeight: 0,
    note: null,
    isCover: index === 0,
  }));
}

export function productToEditorFixture(product: CatalogueProductFixture): {
  fixture: ProductEditorFixture;
  variantGuidance: VariantPricingGuidance[];
} {
  const variants = editorVariants(product);
  const categoryAttributesResult = editorCategoryAttributes(product);
  const issues = [...editorIssues(product), ...categoryAttributesResult.issues];
  // Derived from `product.variants`, not from `variants` above: the latter
  // synthesises a "Default" row for a product with no variant rows at all, and
  // splitting an invented label would propose an axis no supplier ever sent.
  const optionSplit = deriveOptionSplit(
    product.variants.map((variant) => ({
      variantId: variant.id,
      label: variant.supplierOptionLabel,
    })),
  );
  const suggestedAxisNames = suggestedOptionAxisNames(
    optionSplit?.positions ?? [],
    product.categoryPresetVariationAttributes,
  );
  const fixture: ProductEditorFixture = {
    fixtureKey: product.id,
    scenarioLabel: `Database product - ${product.status}`,
    productName: product.name,
    // The supplier's own name for this listing, captured at discovery and
    // never re-fetched - distinct from `productName` above, which is the
    // seller's editable copy. Falls back to the current product name only
    // when no candidate/feed snapshot is linked (no supplier evidence to
    // show at all), which is an honest "nothing better exists" rather than
    // a claim that the supplier used this exact wording.
    supplierProductName: product.supplierProductName ?? product.name,
    // CJ's own category name, not the Sals3 one. These were the same value
    // until 2026-08-14, which made the supplier evidence block report
    // "Unmapped category" as if the supplier had said it.
    supplierCategoryPath: product.supplierCategoryPath ?? 'Not recorded',
    sals3CategoryPath: effectiveCategoryPath(product),
    sals3CategoryL1: effectiveSals3CategoryL1(product),
    sals3CategoryCode: product.categoryCode ?? null,
    categoryMappingConfidence:
      effectiveCategoryPath(product) === 'Unmapped category'
        ? 'UNMAPPED'
        : 'ACCEPTABLE',
    sals3CategoryDeclaredBySeller: sellerDeclaredSals3Category(product),
    realSupplierCandidateId: product.sourceCandidateId ?? null,
    sellerSku: variants[0]?.sellerSku ?? product.sals3ProductId,
    brandDeclaration: 'No brand / generic',
    descriptionText: product.descriptionText ?? '',
    metaDescriptionText: product.metaDescriptionText ?? '',
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
    /**
     * The diff, at last. Both halves are already in memory here — the frozen
     * draft-time record on each variant, and the current snapshot carried on the
     * product — so this reaches no database and no supplier.
     *
     * `variants` rather than `editorVariants(product)`: the latter synthesises a
     * "Default" row for a product with none, and comparing an invented variant
     * against supplier evidence would report a change nobody made.
     */
    sourceChanges: deriveSourceChanges({
      frozen: product.variants.map((variant) => ({
        variantId: variant.id,
        externalVariantId: variant.cjVariantId,
        supplierOptionLabel: variant.supplierOptionLabel,
        displayLabel: variant.optionLabel,
        supplierCost: variant.supplierCost,
        supplierObservedQuantity: variant.supplierObservedQuantity,
        retailPrice: variant.sellingPrice,
      })),
      current: product.supplierEvidence?.variants ?? [],
      capturedAt: product.supplierEvidence?.capturedAt ?? null,
    }),
    sourceChangesCapturedAt: product.supplierEvidence?.capturedAt ?? null,
    optionMapping: {
      // `byCombination` is deliberately not carried: it is a Map, and the client
      // has no use for it. The server re-derives the whole split from the same
      // column before writing, so the browser never supplies structure.
      proposal: optionSplit?.positions ?? [],
      mappedAxisNames: product.optionAxisNames ?? [],
      suggestedAxisNames,
      variantCount: product.variants.length,
      // Free: the raw column is already on every variant here, so telling a
      // missing label apart from a present one that simply does not form a grid
      // costs no second query.
      unlabelledVariantCount: product.variants.filter(
        (variant) => variant.supplierOptionLabel === null,
      ).length,
    },
    specifications: editorSpecifications(product),
    categoryAttributes: categoryAttributesResult.fields,
    categoryAttributesControlsVersion:
      product.categoryAttributeControlsVersion ?? null,
    variants,
    markets: editorMarkets(product),
    marketsNotEnabledCount: 0,
    media: editorSellerMedia(product),
    supplierMedia: editorSupplierMedia(product),
    policyVersion: 'database',
    draftSaveTarget:
      product.currentRevisionId === undefined ||
      product.currentRevisionId === null ||
      product.currentRevisionVersion === undefined ||
      product.currentRevisionVersion === null
        ? null
        : {
            productId: product.id,
            revisionId: product.currentRevisionId,
            expectedRevisionVersion: product.currentRevisionVersion,
          },
    publishTarget:
      product.productVersion === undefined
        ? null
        : {
            productId: product.id,
            expectedProductVersion: product.productVersion,
          },
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
