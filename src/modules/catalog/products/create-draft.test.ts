import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
  findEvaluationByCandidateId: vi.fn(),
  findIdempotencyRecord: vi.fn(),
  findSnapshotByCandidateId: vi.fn(),
  insertIdempotencyRecordIfAbsent: vi.fn(),
}));

vi.mock('@/modules/market-config/capabilities', () => ({
  findAuthorizedDestination: vi.fn(),
  resolveSellerMarketCapabilities: vi.fn(),
}));

vi.mock('@/modules/market-config/repository', () => ({
  listProfilesForSeller: vi.fn(),
}));

vi.mock('@/modules/pricing/resolver', () => ({
  resolveProductPricing: vi.fn(),
}));

vi.mock('@/modules/catalog/taxonomy/resolver', () => ({
  resolveCategoryMapping: vi.fn(),
}));

vi.mock('@/modules/catalog/taxonomy/repository', () => ({
  assignProductCategory: vi.fn(),
  findCategoryByCode: vi.fn(),
}));

vi.mock('@/modules/catalog/taxonomy/cj-mirror', () => ({
  ensureCjCategoryMirror: vi.fn(),
}));

vi.mock('./media-projection', () => ({
  projectSupplierMediaForProduct: vi.fn(),
  SUPPLIER_MEDIA_RIGHTS: {
    rightsBasis: 'SUPPLIER_TERMS',
    reviewState: 'APPROVED',
  },
}));

vi.mock('./repository', () => ({
  findBinding: vi.fn(),
  findCandidateSourceForSeller: vi.fn(),
  findHighestRevisionNumber: vi.fn(),
  findOffer: vi.fn(),
  findOpenDraftRevision: vi.fn(),
  findProductById: vi.fn(),
  findProviderProductReference: vi.fn(),
  findProviderVariantReference: vi.fn(),
  insertDraftRevision: vi.fn(),
  insertDraftVariant: vi.fn(),
  insertProduct: vi.fn(),
  insertProviderProductReference: vi.fn(),
  insertProviderVariantReference: vi.fn(),
  insertUnpublishedOffer: vi.fn(),
  insertUnverifiedBinding: vi.fn(),
  listVariantsForProduct: vi.fn(),
  setCurrentRevision: vi.fn(),
}));

/* eslint-disable import/first */
import {
  appendAuditEvent,
  findEvaluationByCandidateId,
  findIdempotencyRecord,
  findSnapshotByCandidateId,
  insertIdempotencyRecordIfAbsent,
} from '@/modules/catalog/candidates/repository';
import {
  findAuthorizedDestination,
  resolveSellerMarketCapabilities,
} from '@/modules/market-config/capabilities';
import { listProfilesForSeller } from '@/modules/market-config/repository';
import { resolveProductPricing } from '@/modules/pricing/resolver';
import { ensureCjCategoryMirror } from '@/modules/catalog/taxonomy/cj-mirror';
import {
  assignProductCategory,
  findCategoryByCode,
} from '@/modules/catalog/taxonomy/repository';
import { resolveCategoryMapping } from '@/modules/catalog/taxonomy/resolver';

import { CREATE_PRODUCT_DRAFT_OPERATION } from './contracts';
import createProductDraftFromCandidate from './create-draft';
import { projectSupplierMediaForProduct } from './media-projection';
import { canonicalRequestHash, deriveSals3Sku } from './identity';
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
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/** Runs the callback against a marker executor, like a real transaction would. */
const DATABASE = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ marker: 'tx' }),
  ),
} as never;

const SELLER_A = '11111111-1111-4111-8111-111111111111';
const SELLER_B = '22222222-2222-4222-8222-222222222222';
const CANDIDATE = '33333333-3333-4333-8333-333333333333';

const SOURCE = {
  candidateId: CANDIDATE,
  externalProductId: 'PID-1',
  supplierConnectionId: 'connection-1',
  connectionStatus: 'CONNECTED' as const,
  supplierProviderId: 'provider-1',
  supplierProviderCode: 'CJ_DROPSHIPPING',
  providerCategoryId: 'CJ-CATEGORY-1',
};

/** The resolver's normal answer while no approved mapping covers a category. */
const UNMAPPED_DECISION = {
  outcome: 'UNMAPPED' as const,
  needsReview: true,
  reason: 'NO_ACTIVE_MAPPING',
  reasonLabel: 'No active mapping',
  mappingId: null,
  mappingVersion: null,
  resolverVersion: 'category-mapping-resolver-v1',
};

const MAPPED_DECISION = {
  outcome: 'MAPPED_ACCEPTABLE' as const,
  needsReview: false,
  sals3CategoryCode: 'CAT-MEN-100230',
  sals3CategoryPath: 'Apparel & Accessories > Jackets > -',
  taxonomyVersion: 'sals3-taxonomy-v0',
  mappingId: 'mapping-1',
  mappingVersion: 1,
  method: 'EXTERNAL_ID_RULE',
  confidence: 'ACCEPTABLE' as const,
  reviewStatus: 'APPROVED',
  observedCategoryPath: "Men's Jackets",
  resolverVersion: 'category-mapping-resolver-v1',
};

const EVIDENCE_VARIANT = {
  vid: 'VID-1',
  sku: 'CJ-SKU-1',
  optionLabel: 'Black-1XL',
  priceUsd: 12.34,
  weightGrams: 210,
  totalInventory: 44,
};

function evidenceSnapshot(variants: unknown[] = [EVIDENCE_VARIANT]) {
  return {
    id: 'snapshot-1',
    candidateId: CANDIDATE,
    checksum: 'evidence-checksum',
    schemaVersion: 'v1',
    capturedAt: new Date('2026-08-01T00:00:00.000Z'),
    evidence: {
      name: 'Supplier hoodie',
      capturedAt: '2026-08-01T00:00:00.000Z',
      variants,
    },
  };
}

const PRODUCT = {
  id: 'product-1',
  stewardSellerAccountId: SELLER_A,
  version: 1,
  publicationState: 'UNPUBLISHED' as const,
  title: 'Supplier hoodie',
  categoryId: null,
  categoryMappingVersion: null,
};

const REFERENCE = {
  id: 'ppr-1',
  productId: PRODUCT.id,
  supplierProviderId: SOURCE.supplierProviderId,
  externalProductId: SOURCE.externalProductId,
};

function activeProfile(destination: string) {
  return {
    id: `profile-${destination}`,
    sellerAccountId: SELLER_A,
    destinationCountryCode: destination,
    status: 'ACTIVE' as const,
  };
}

function run(
  overrides: Partial<
    Parameters<typeof createProductDraftFromCandidate>[0]
  > = {},
) {
  return createProductDraftFromCandidate({
    candidateId: CANDIDATE,
    sellerAccountId: SELLER_A,
    actorId: 'actor-1',
    idempotencyKey: 'idem-key-0001',
    database: DATABASE,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  asMock(appendAuditEvent).mockResolvedValue(undefined);
  asMock(insertIdempotencyRecordIfAbsent).mockResolvedValue(true);
  asMock(findIdempotencyRecord).mockResolvedValue(null);
  asMock(findEvaluationByCandidateId).mockResolvedValue({
    feedSnapshot: { name: 'Feed name' },
  });
  asMock(findSnapshotByCandidateId).mockResolvedValue(evidenceSnapshot());
  asMock(findCandidateSourceForSeller).mockResolvedValue(SOURCE);
  asMock(findProviderProductReference).mockResolvedValue(null);
  asMock(findProductById).mockResolvedValue(null);
  asMock(insertProduct).mockResolvedValue(PRODUCT);
  asMock(insertProviderProductReference).mockResolvedValue(REFERENCE);
  asMock(findOpenDraftRevision).mockResolvedValue(null);
  asMock(findHighestRevisionNumber).mockResolvedValue(0);
  asMock(insertDraftRevision).mockResolvedValue({
    id: 'revision-1',
    revisionNumber: 1,
    workflowState: 'DRAFT',
    contentChecksum: 'checksum',
  });
  asMock(setCurrentRevision).mockResolvedValue(undefined);
  asMock(findProviderVariantReference).mockResolvedValue(null);
  asMock(insertDraftVariant).mockResolvedValue({
    id: 'variant-1',
    sals3Sku: 'S3V-ABC',
    status: 'DRAFT',
    optionCombinationKey: null,
  });
  asMock(insertProviderVariantReference).mockResolvedValue({ id: 'pvr-1' });
  asMock(listVariantsForProduct).mockResolvedValue([]);
  asMock(findOffer).mockResolvedValue(null);
  asMock(insertUnpublishedOffer).mockResolvedValue({
    id: 'offer-1',
    publishState: 'UNPUBLISHED',
    pricingState: 'UNRESOLVED',
    pricingUnavailableReason: 'CATEGORY_MAPPING_REQUIRES_REVIEW',
  });
  asMock(findBinding).mockResolvedValue(null);
  asMock(insertUnverifiedBinding).mockResolvedValue({
    id: 'binding-1',
    state: 'UNVERIFIED',
    stateReason: 'NO_SUPPLIER_VERIFICATION_PERFORMED',
  });
  asMock(listProfilesForSeller).mockResolvedValue([activeProfile('AU')]);
  asMock(findAuthorizedDestination).mockImplementation((code: string) =>
    code === 'AU' ? { destinationCountryCode: 'AU' } : null,
  );
  asMock(resolveSellerMarketCapabilities).mockReturnValue({
    capabilityVersion: 'capability-v1',
    source: 'test',
    destinations: [{ destinationCountryCode: 'AU' }],
  });
  asMock(resolveProductPricing).mockResolvedValue({
    outcome: 'PRICING_UNAVAILABLE',
    reason: 'CATEGORY_MAPPING_REQUIRES_REVIEW',
    reasonLabel: 'Category mapping requires review',
    resolverVersion: 'pricing-resolver-v1',
  });
  // The environment as it actually stands: no approved mapping and no stored
  // image address. Every test that cares about the opposite says so locally.
  // The mirror answering `null` models a candidate with nothing to mirror —
  // the one case that still leaves a draft UNMAPPED.
  asMock(resolveCategoryMapping).mockResolvedValue(UNMAPPED_DECISION);
  asMock(ensureCjCategoryMirror).mockResolvedValue(null);
  asMock(findCategoryByCode).mockResolvedValue(null);
  asMock(assignProductCategory).mockResolvedValue(null);
  asMock(projectSupplierMediaForProduct).mockResolvedValue({
    inserted: 0,
    skipped: 0,
    source: 'NONE',
  });
});

describe('createProductDraftFromCandidate — tenant isolation', () => {
  it('returns not_found for a candidate this seller does not own', async () => {
    // The scoped query is what decides; a cross-tenant id simply resolves to
    // nothing, so the caller cannot distinguish it from a candidate that
    // never existed.
    asMock(findCandidateSourceForSeller).mockResolvedValue(null);

    await expect(run({ sellerAccountId: SELLER_B })).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('writes nothing when the candidate is not resolvable', async () => {
    asMock(findCandidateSourceForSeller).mockResolvedValue(null);

    await run({ sellerAccountId: SELLER_B });

    expect(insertProduct).not.toHaveBeenCalled();
    expect(insertUnpublishedOffer).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
    expect(insertIdempotencyRecordIfAbsent).not.toHaveBeenCalled();
  });

  it('never passes a caller-supplied seller id to the scoped lookup', async () => {
    await run();

    expect(findCandidateSourceForSeller).toHaveBeenCalledWith(
      expect.anything(),
      CANDIDATE,
      SELLER_A,
    );
  });
});

describe('createProductDraftFromCandidate — canonical identity', () => {
  it('creates one product, one provider reference, and one draft revision', async () => {
    const outcome = await run();

    expect(outcome.ok).toBe(true);
    expect(insertProduct).toHaveBeenCalledTimes(1);
    expect(insertProviderProductReference).toHaveBeenCalledTimes(1);
    expect(insertDraftRevision).toHaveBeenCalledTimes(1);
    if (outcome.ok) {
      expect(outcome.result.productId).toBe(PRODUCT.id);
      expect(outcome.result.revisionId).toBe('revision-1');
      expect(outcome.result.publicationState).toBe('UNPUBLISHED');
    }
  });

  it('reuses the canonical product when the same CJ pid is already referenced', async () => {
    // Spec §4.2: re-importing the same pid returns the existing product.
    asMock(findProviderProductReference).mockResolvedValue(REFERENCE);
    asMock(findProductById).mockResolvedValue(PRODUCT);
    asMock(findOpenDraftRevision).mockResolvedValue({ id: 'revision-1' });

    const outcome = await run({ idempotencyKey: 'idem-key-0002' });

    expect(insertProduct).not.toHaveBeenCalled();
    expect(insertProviderProductReference).not.toHaveBeenCalled();
    expect(insertDraftRevision).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.result.productId).toBe(PRODUCT.id);
  });

  it('looks the reference up by the exact provider and external id, never by title', async () => {
    // A title/slug/image match must never merge two distinct CJ products.
    await run();

    expect(findProviderProductReference).toHaveBeenCalledWith(
      expect.anything(),
      SOURCE.supplierProviderId,
      SOURCE.externalProductId,
    );
  });

  it('records the evidence capture time as observed-at, not the current instant', async () => {
    await run();

    const [, args] = asMock(insertProviderProductReference).mock.calls[0];

    expect(args.snapshotChecksum).toBe('evidence-checksum');
    expect(args.lastObservedAt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });
});

describe('createProductDraftFromCandidate — stewardship', () => {
  it('creates no revision and reports stewardship when another seller owns the editorial record', async () => {
    asMock(findProviderProductReference).mockResolvedValue(REFERENCE);
    asMock(findProductById).mockResolvedValue({
      ...PRODUCT,
      stewardSellerAccountId: SELLER_B,
    });

    const outcome = await run();

    expect(insertDraftRevision).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.result.revisionId).toBeNull();
    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'EDITORIAL_RECORD_STEWARDED_BY_ANOTHER_SELLER',
    );
  });
});

describe('createProductDraftFromCandidate — variants from persisted evidence only', () => {
  it('creates a DRAFT variant with a deterministic Sals3 SKU per CJ variant', async () => {
    await run();

    const [, args] = asMock(insertDraftVariant).mock.calls[0];

    expect(args.sals3Sku).toBe(
      deriveSals3Sku({
        providerCode: 'CJ_DROPSHIPPING',
        externalProductId: 'PID-1',
        externalVariantId: 'VID-1',
      }),
    );
    expect(args.weightGrams).toBe(210);
  });

  it('preserves the raw CJ option label without parsing it into option axes', async () => {
    // Splitting "Black-1XL" would be a guess about which token is a colour;
    // a wrong guess becomes a customer-facing product attribute.
    await run();

    const [, args] = asMock(insertProviderVariantReference).mock.calls[0];

    expect(args.sourceOptionLabel).toBe('Black-1XL');
    expect(args.externalVariantId).toBe('VID-1');
    expect(args.lastObservedCostMinor).toBe(BigInt(1234));
    expect(args.lastObservedCostCurrency).toBe('USD');
  });

  it('reports unmapped options so nothing reads as a sellable variant', async () => {
    const outcome = await run();

    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'PRODUCT_OPTIONS_UNMAPPED',
    );
  });

  it('fabricates no variant, provider variant, or binding from a summary-only candidate', async () => {
    // A screening-stage block never reaches the evidence fetch, so there is
    // no snapshot - and no vid to invent one from.
    asMock(findSnapshotByCandidateId).mockResolvedValue(null);

    const outcome = await run();

    expect(insertDraftVariant).not.toHaveBeenCalled();
    expect(insertProviderVariantReference).not.toHaveBeenCalled();
    expect(insertUnverifiedBinding).not.toHaveBeenCalled();
    expect(insertUnpublishedOffer).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'NO_PERSISTED_SUPPLIER_EVIDENCE',
    );
    // The product and its draft are still real and still created.
    expect(insertProduct).toHaveBeenCalledTimes(1);
    expect(insertDraftRevision).toHaveBeenCalledTimes(1);
  });

  it('reports empty evidence variants distinctly from absent evidence', async () => {
    asMock(findSnapshotByCandidateId).mockResolvedValue(evidenceSnapshot([]));

    const outcome = await run();

    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'NO_SUPPLIER_VARIANTS_IN_EVIDENCE',
    );
    expect(outcome.ok && outcome.result.missingRequirements).not.toContain(
      'NO_PERSISTED_SUPPLIER_EVIDENCE',
    );
  });

  it('reuses an existing provider variant reference instead of duplicating it', async () => {
    asMock(findProviderVariantReference).mockResolvedValue({
      id: 'pvr-1',
      variantId: 'variant-1',
    });

    await run();

    expect(insertDraftVariant).not.toHaveBeenCalled();
    expect(insertProviderVariantReference).not.toHaveBeenCalled();
  });
});

describe('createProductDraftFromCandidate — market and pricing boundaries', () => {
  it('creates no offer when the seller has no ACTIVE market profile', async () => {
    asMock(listProfilesForSeller).mockResolvedValue([
      { ...activeProfile('AU'), status: 'DRAFT' },
    ]);

    const outcome = await run();

    expect(insertUnpublishedOffer).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'NO_ACTIVE_MARKET_PROFILE',
    );
  });

  it('creates no offer for an ACTIVE profile whose destination is no longer authorized', async () => {
    // Narrowing the platform capability list must narrow offer creation
    // immediately, without editing any seller row.
    asMock(listProfilesForSeller).mockResolvedValue([activeProfile('PH')]);
    asMock(findAuthorizedDestination).mockReturnValue(null);

    const outcome = await run();

    expect(insertUnpublishedOffer).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'NO_ACTIVE_MARKET_PROFILE',
    );
  });

  it('takes the market code from the seller profile, never from a hardcoded constant', async () => {
    asMock(listProfilesForSeller).mockResolvedValue([activeProfile('PH')]);
    asMock(findAuthorizedDestination).mockReturnValue({
      destinationCountryCode: 'PH',
    });

    await run();

    const [, args] = asMock(insertUnpublishedOffer).mock.calls[0];

    expect(args.marketCode).toBe('PH');
    expect(args.marketProfileId).toBe('profile-PH');
    expect(args.marketCapabilityVersion).toBe('capability-v1');
  });

  it('creates an UNPUBLISHED, unpriced offer carrying the resolver reason', async () => {
    const outcome = await run();

    const [, args] = asMock(insertUnpublishedOffer).mock.calls[0];

    expect(args.fulfillmentMode).toBe('SUPPLIER_DROPSHIP');
    expect(args.pricingUnavailableReason).toBe(
      'CATEGORY_MAPPING_REQUIRES_REVIEW',
    );
    expect(outcome.ok && outcome.result.pricingUnavailableReason).toBe(
      'CATEGORY_MAPPING_REQUIRES_REVIEW',
    );
    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'PRICING_UNRESOLVED',
    );
  });

  it('delegates pricing to the ADR-015 resolver rather than computing a price here', async () => {
    await run();

    expect(resolveProductPricing).toHaveBeenCalledTimes(1);
    const [, args] = asMock(resolveProductPricing).mock.calls[0];

    expect(args.sellerAccountId).toBe(SELLER_A);
    expect(args.settlementCurrency).toBe('USD');
  });

  it('reuses an existing offer on the same tuple instead of creating a second', async () => {
    asMock(findOffer).mockResolvedValue({ id: 'offer-1' });

    await run();

    expect(insertUnpublishedOffer).not.toHaveBeenCalled();
  });
});

describe('createProductDraftFromCandidate — supplier binding truthfulness', () => {
  it('binds an offer to the exact connection and provider variant when healthy', async () => {
    await run();

    const [, args] = asMock(insertUnverifiedBinding).mock.calls[0];

    expect(args.offerId).toBe('offer-1');
    expect(args.supplierConnectionId).toBe('connection-1');
    expect(args.providerVariantReferenceId).toBe('pvr-1');
  });

  it('creates no binding when the supplier connection is not workable', async () => {
    asMock(findCandidateSourceForSeller).mockResolvedValue({
      ...SOURCE,
      connectionStatus: 'DISCONNECTED',
    });

    const outcome = await run();

    expect(insertUnverifiedBinding).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'SUPPLIER_CONNECTION_UNHEALTHY',
    );
    // The offer itself is still legitimate; only the fulfillment claim is not.
    expect(insertUnpublishedOffer).toHaveBeenCalledTimes(1);
  });
});

describe('createProductDraftFromCandidate — honesty of the result', () => {
  it('never reports a published, active, or ready state', async () => {
    const outcome = await run();

    expect(outcome.ok && outcome.result.publicationState).toBe('UNPUBLISHED');
    // Whole quoted values, so the legitimate `"UNPUBLISHED"` does not match.
    const serialized = JSON.stringify(outcome);

    expect(serialized).not.toMatch(/: ?"PUBLISHED"/);
    expect(serialized).not.toMatch(/: ?"READY"/);
    expect(serialized).not.toMatch(/: ?"ACTIVE"/);
  });

  it('reports the media and description gaps rather than implying completeness', async () => {
    const outcome = await run();

    expect(outcome.ok && outcome.result.missingRequirements).toEqual(
      expect.arrayContaining([
        'MEDIA_SOURCE_NOT_RECORDED',
        'STRUCTURED_DESCRIPTION_REQUIRED',
        'CATEGORY_MAPPING_REQUIRED',
      ]),
    );
  });
});

describe('createProductDraftFromCandidate — supplier media provenance', () => {
  it('projects the stored supplier image into the draft, with the owner’s rights basis', async () => {
    asMock(projectSupplierMediaForProduct).mockResolvedValue({
      inserted: 1,
      skipped: 0,
      source: 'FEED_SNAPSHOT',
    });

    const outcome = await run();

    expect(projectSupplierMediaForProduct).toHaveBeenCalledWith(
      { marker: 'tx' },
      {
        productId: PRODUCT.id,
        candidateId: CANDIDATE,
        actorId: 'actor-1',
        rights: { rightsBasis: 'SUPPLIER_TERMS', reviewState: 'APPROVED' },
      },
    );
    // The gap is reported from the projection's real answer, not assumed.
    expect(outcome.ok && outcome.result.missingRequirements).not.toContain(
      'MEDIA_SOURCE_NOT_RECORDED',
    );
  });

  it('still reports the gap when the database holds no image address', async () => {
    const outcome = await run();

    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'MEDIA_SOURCE_NOT_RECORDED',
    );
  });

  it('writes no media onto a product another seller stewards', async () => {
    asMock(findProviderProductReference).mockResolvedValue(REFERENCE);
    asMock(findProductById).mockResolvedValue({
      ...PRODUCT,
      stewardSellerAccountId: SELLER_B,
    });

    const outcome = await run();

    expect(projectSupplierMediaForProduct).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'MEDIA_SOURCE_NOT_RECORDED',
    );
  });
});

describe('createProductDraftFromCandidate — Sals3 category from the crosswalk', () => {
  it('assigns the category an approved, active mapping resolves to', async () => {
    asMock(resolveCategoryMapping).mockResolvedValue(MAPPED_DECISION);
    asMock(findCategoryByCode).mockResolvedValue({
      id: 'category-1',
      code: 'CAT-MEN-100230',
      path: MAPPED_DECISION.sals3CategoryPath,
    });
    asMock(assignProductCategory).mockResolvedValue({
      ...PRODUCT,
      categoryId: 'category-1',
      version: 2,
    });

    const outcome = await run();

    expect(assignProductCategory).toHaveBeenCalledWith(
      { marker: 'tx' },
      expect.objectContaining({
        productId: PRODUCT.id,
        stewardSellerAccountId: SELLER_A,
        expectedVersion: PRODUCT.version,
        categoryId: 'category-1',
        categoryMappingConfidence: 'ACCEPTABLE',
        categoryMappingId: 'mapping-1',
        categoryMappingVersion: 1,
      }),
    );
    expect(outcome.ok && outcome.result.missingRequirements).not.toContain(
      'CATEGORY_MAPPING_REQUIRED',
    );
  });

  it('resolves from the provider category id and CJ’s own category name', async () => {
    asMock(findSnapshotByCandidateId).mockResolvedValue({
      ...evidenceSnapshot(),
      evidence: {
        ...evidenceSnapshot().evidence,
        categoryName: "Men's Jackets",
      },
    });

    await run();

    expect(resolveCategoryMapping).toHaveBeenCalledWith(
      { marker: 'tx' },
      expect.objectContaining({
        provider: 'CJ_DROPSHIPPING',
        externalCategoryId: 'CJ-CATEGORY-1',
        observedCategoryPath: "Men's Jackets",
      }),
    );
  });

  it('falls back to the feed snapshot category when no detail evidence exists', async () => {
    asMock(findSnapshotByCandidateId).mockResolvedValue(null);
    asMock(findEvaluationByCandidateId).mockResolvedValue({
      feedSnapshot: {
        name: 'Feed name',
        category: "Men's Jackets",
        categoryId: 'CJ-CATEGORY-1',
        priceUsdCents: 1526,
        listedCount: 17,
        shipsFrom: ['CN'],
      },
    });

    await run();

    expect(resolveCategoryMapping).toHaveBeenCalledWith(
      { marker: 'tx' },
      expect.objectContaining({ observedCategoryPath: "Men's Jackets" }),
    );
  });

  it('mirrors the CJ category when no reviewed mapping covers it', async () => {
    // Owner decision 2026-08-14: the CJ category IS the Sals3 category, so
    // an unmapped resolver answer triggers the mirror instead of leaving the
    // draft uncategorised.
    asMock(ensureCjCategoryMirror).mockResolvedValue({
      mapping: {
        id: 'mirror-mapping-1',
        mappingVersion: 1,
        confidence: 'EXACT',
        taxonomyVersion: 'sals3-taxonomy-v0',
      },
      category: {
        id: 'category-cj-1',
        code: 'CJ-CJ-CATEGORY-1',
        path: "Men's Jackets",
      },
    });
    asMock(assignProductCategory).mockResolvedValue({
      ...PRODUCT,
      categoryId: 'category-cj-1',
      version: 2,
    });

    const outcome = await run();

    expect(ensureCjCategoryMirror).toHaveBeenCalledWith(
      { marker: 'tx' },
      expect.objectContaining({
        provider: 'CJ_DROPSHIPPING',
        externalCategoryId: 'CJ-CATEGORY-1',
        actorId: 'actor-1',
      }),
    );
    expect(assignProductCategory).toHaveBeenCalledWith(
      { marker: 'tx' },
      expect.objectContaining({
        categoryId: 'category-cj-1',
        categoryMappingConfidence: 'EXACT',
        categoryMappingId: 'mirror-mapping-1',
        categoryMappingVersion: 1,
      }),
    );
    expect(outcome.ok && outcome.result.missingRequirements).not.toContain(
      'CATEGORY_MAPPING_REQUIRED',
    );
  });

  it('leaves the product UNMAPPED only when there is no CJ category to mirror', async () => {
    // The default mirror answer is `null` — the candidate carries no provider
    // category, so there is genuinely nothing to categorise the product with.
    const outcome = await run();

    expect(assignProductCategory).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.result.missingRequirements).toContain(
      'CATEGORY_MAPPING_REQUIRED',
    );
  });

  it('writes no category onto a product another seller stewards', async () => {
    asMock(resolveCategoryMapping).mockResolvedValue(MAPPED_DECISION);
    asMock(findProviderProductReference).mockResolvedValue(REFERENCE);
    asMock(findProductById).mockResolvedValue({
      ...PRODUCT,
      stewardSellerAccountId: SELLER_B,
    });

    await run();

    expect(resolveCategoryMapping).not.toHaveBeenCalled();
    expect(assignProductCategory).not.toHaveBeenCalled();
  });
});

describe('createProductDraftFromCandidate — idempotency', () => {
  /** The exact hash the module derives for the default request. */
  const REQUEST_HASH = canonicalRequestHash({
    operation: CREATE_PRODUCT_DRAFT_OPERATION,
    candidateId: CANDIDATE,
    sellerAccountId: SELLER_A,
  });

  it('records the key inside the same transaction as the catalog writes', async () => {
    await run();

    expect(insertIdempotencyRecordIfAbsent).toHaveBeenCalledTimes(1);
    const [executor, record] = asMock(insertIdempotencyRecordIfAbsent).mock
      .calls[0];

    // The marker proves it ran on the transaction's executor, not the pool -
    // otherwise a crash between the writes and the key could leave catalog
    // rows that no replay would ever recognise.
    expect(executor).toEqual({ marker: 'tx' });
    expect(record.operation).toBe(CREATE_PRODUCT_DRAFT_OPERATION);
    expect(record.requestHash).toBe(REQUEST_HASH);
  });

  it('replays the stored result and writes nothing on the same key and payload', async () => {
    asMock(findIdempotencyRecord).mockResolvedValue({
      key: 'idem-key-0001',
      operation: CREATE_PRODUCT_DRAFT_OPERATION,
      requestHash: REQUEST_HASH,
      resultReference: { productId: PRODUCT.id, offerIds: ['offer-1'] },
    });

    const outcome = await run();

    expect(outcome.ok && outcome.result.productId).toBe(PRODUCT.id);
    expect(outcome.ok && outcome.result.replayed).toBe(true);
    expect(insertProduct).not.toHaveBeenCalled();
    expect(insertUnpublishedOffer).not.toHaveBeenCalled();
    expect(insertIdempotencyRecordIfAbsent).not.toHaveBeenCalled();
  });

  it('conflicts when the same key arrives with a different payload', async () => {
    // Spec §4.2: same key + different canonical request is
    // IDEMPOTENCY_CONFLICT, never a silent overwrite of the first result.
    asMock(findIdempotencyRecord).mockResolvedValue({
      key: 'idem-key-0001',
      operation: CREATE_PRODUCT_DRAFT_OPERATION,
      requestHash: 'hash-of-a-different-candidate',
      resultReference: {},
    });

    await expect(run()).resolves.toEqual({
      ok: false,
      reason: 'idempotency_conflict',
    });
    expect(insertProduct).not.toHaveBeenCalled();
  });

  it('conflicts when the same key is reused under a different operation', async () => {
    asMock(findIdempotencyRecord).mockResolvedValue({
      key: 'idem-key-0001',
      operation: 'catalog.candidate.shortlist',
      requestHash: REQUEST_HASH,
      resultReference: {},
    });

    await expect(run()).resolves.toEqual({
      ok: false,
      reason: 'idempotency_conflict',
    });
  });

  it('audits a rejected conflicting replay instead of failing silently', async () => {
    asMock(findIdempotencyRecord).mockResolvedValue({
      key: 'idem-key-0001',
      operation: CREATE_PRODUCT_DRAFT_OPERATION,
      requestHash: 'a-different-request',
      resultReference: {},
    });

    await run();

    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product_draft.idempotency_conflict',
      }),
    );
  });

  it('replays the winner of a concurrent duplicate rather than double-writing', async () => {
    // Two identical clicks land at once. The loser's create-or-nothing insert
    // matches zero rows, so its whole transaction rolls back; the retry then
    // finds the record the winner committed and replays it.
    asMock(insertIdempotencyRecordIfAbsent).mockResolvedValue(false);

    let winnerCommitted = false;
    asMock(findIdempotencyRecord).mockImplementation(async () => {
      if (!winnerCommitted) {
        winnerCommitted = true;
        return null;
      }

      return {
        key: 'idem-key-0001',
        operation: CREATE_PRODUCT_DRAFT_OPERATION,
        requestHash: REQUEST_HASH,
        resultReference: { productId: PRODUCT.id, offerIds: ['offer-1'] },
      };
    });

    const outcome = await run();

    expect(outcome.ok && outcome.result.productId).toBe(PRODUCT.id);
    expect(outcome.ok && outcome.result.replayed).toBe(true);
    // The loser attempted its writes exactly once and they were rolled back;
    // it never retried them against the winner's committed state.
    expect(insertProduct).toHaveBeenCalledTimes(1);
  });
});

describe('createProductDraftFromCandidate — audit trail', () => {
  it('appends an append-only event for every created entity', async () => {
    await run();

    const actions = asMock(appendAuditEvent).mock.calls.map(
      ([, event]) => event.action,
    );

    expect(actions).toEqual(
      expect.arrayContaining([
        'catalog_product.created',
        'catalog_product_revision.created',
        'catalog_product_variant.created',
        'catalog_product_offer.created',
        'catalog_offer_supplier_binding.created',
      ]),
    );
  });

  it('records the actor from the caller on every event', async () => {
    await run();

    asMock(appendAuditEvent).mock.calls.forEach(([, event]) => {
      expect(event.actorId).toBe('actor-1');
    });
  });

  it('records a reuse as a reuse, not as a creation', async () => {
    asMock(findProviderProductReference).mockResolvedValue(REFERENCE);
    asMock(findProductById).mockResolvedValue(PRODUCT);
    asMock(findOpenDraftRevision).mockResolvedValue({ id: 'revision-1' });

    await run();

    const actions = asMock(appendAuditEvent).mock.calls.map(
      ([, event]) => event.action,
    );

    expect(actions).toContain('catalog_product.reused');
    expect(actions).not.toContain('catalog_product.created');
  });

  it('never puts a supplier payload or connection secret in an audit payload', async () => {
    await run();

    const serialized = JSON.stringify(
      asMock(appendAuditEvent).mock.calls.map(([, event]) => event),
    );

    expect(serialized).not.toContain('evidence');
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('apiKey');
  });
});
