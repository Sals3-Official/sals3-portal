import type {
  CategoryMappingConfidence,
  ProviderCategoryMappingMethod,
  ProviderCategoryMappingReviewStatus,
} from '@/lib/db/schema';

/**
 * Contracts for the CJ-to-Sals3 category mapping pilot (ADR-002).
 *
 * Every type here describes a *decision about persisted facts*. Nothing in
 * this module accepts a supplier response, a browser-supplied category code,
 * or a free-text category name as an input it would act on, and no shape
 * below can express "probably this category" — a result either names a real
 * Sals3 code that an approved, active mapping pointed at, or it names a
 * review reason and no code at all.
 */

/** Bumped whenever the resolver's precedence or acceptance rules change, so a recorded decision can be traced to the logic that produced it — same idiom as `PRICING_RESOLVER_VERSION`. */
export const CATEGORY_MAPPING_RESOLVER_VERSION = 'category-mapping-resolver-v1';

/** Bumped whenever the derived form contract (required attributes, variation tiers) changes shape. */
export const CATEGORY_FORM_CONTRACT_VERSION = 'category-form-contract-v1';

/**
 * The only supplier-category facts the resolver will look at. All three are
 * read from `supplier_candidates`; none may be supplied by a browser, and
 * none is ever fetched from CJ. A missing `externalCategoryId` is a normal,
 * expected input — it resolves to `UNMAPPED`, never to a lookup.
 */
export type ProviderCategoryFacts = {
  provider: 'CJ_DROPSHIPPING';
  externalCategoryId: string | null;
  observedCategoryPath: string | null;
};

export type CategoryMappingResolutionInput = ProviderCategoryFacts & {
  /**
   * Which taxonomy extraction the caller is resolving against. An active
   * mapping written against a different extraction is reported as stale
   * rather than silently reused.
   */
  taxonomyVersion: string;
  /**
   * The mapping version a caller previously recorded against this decision,
   * if any. When the active mapping has moved past it, the answer is
   * `MAPPING_SUPERSEDED` — the caller must revalidate rather than inherit.
   */
  expectedMappingVersion: number | null;
};

export type CategoryMappingReviewReason =
  | 'PROVIDER_CATEGORY_MISSING'
  | 'NO_ACTIVE_MAPPING'
  | 'MAPPING_MARKED_AMBIGUOUS'
  | 'MAPPING_MARKED_UNMAPPED'
  | 'MAPPING_VERSION_SUPERSEDED'
  | 'TAXONOMY_VERSION_MISMATCH'
  | 'MAPPING_TARGET_CATEGORY_MISSING';

export const CATEGORY_MAPPING_REVIEW_REASON_LABELS: Record<
  CategoryMappingReviewReason,
  string
> = {
  PROVIDER_CATEGORY_MISSING: 'Supplier category not recorded',
  NO_ACTIVE_MAPPING: 'No approved category mapping',
  MAPPING_MARKED_AMBIGUOUS: 'Category mapping is ambiguous',
  MAPPING_MARKED_UNMAPPED: 'Supplier category has no Sals3 category',
  MAPPING_VERSION_SUPERSEDED: 'Category mapping has been superseded',
  TAXONOMY_VERSION_MISMATCH: 'Category mapping uses a different taxonomy',
  MAPPING_TARGET_CATEGORY_MISSING: 'Mapped Sals3 category is unavailable',
};

type MappedDecision = {
  outcome: 'MAPPED_EXACT' | 'MAPPED_ACCEPTABLE';
  needsReview: false;
  sals3CategoryCode: string;
  sals3CategoryPath: string;
  taxonomyVersion: string;
  mappingId: string;
  mappingVersion: number;
  method: ProviderCategoryMappingMethod;
  confidence: Extract<CategoryMappingConfidence, 'EXACT' | 'ACCEPTABLE'>;
  reviewStatus: ProviderCategoryMappingReviewStatus;
  /** Snapshot the mapping was reviewed against — explanation for a reviewer, never an identity. */
  observedCategoryPath: string | null;
  resolverVersion: string;
};

type ReviewDecision = {
  outcome: 'AMBIGUOUS' | 'UNMAPPED' | 'MAPPING_SUPERSEDED';
  needsReview: true;
  reason: CategoryMappingReviewReason;
  reasonLabel: string;
  /** Present when a mapping row was found and rejected; `null` when none exists. */
  mappingId: string | null;
  mappingVersion: number | null;
  resolverVersion: string;
};

/**
 * Deliberately carries no seller, connection, or candidate identifier: the
 * mapping is global reference data, so a decision object can be rendered or
 * logged without leaking anything tenant-scoped.
 */
export type CategoryMappingDecision = MappedDecision | ReviewDecision;

export function isMappedDecision(
  decision: CategoryMappingDecision,
): decision is MappedDecision {
  return (
    decision.outcome === 'MAPPED_EXACT' ||
    decision.outcome === 'MAPPED_ACCEPTABLE'
  );
}

// --- Category form contract ------------------------------------------------

/**
 * How many variation tiers the taxonomy preset permits. Derived only from an
 * exact, allow-listed prefix of the workbook's `Variation Architecture`
 * string; anything the allow list does not recognise becomes `UNKNOWN` and a
 * review finding, never a guessed tier count.
 */
export type VariationTierCount = 'ONE_TIER' | 'TWO_TIER' | 'UNKNOWN';

export type CategoryFormUnavailableReason =
  'CATEGORY_NOT_FOUND' | 'TAXONOMY_PRESET_UNAVAILABLE';

export const CATEGORY_FORM_UNAVAILABLE_REASON_LABELS: Record<
  CategoryFormUnavailableReason,
  string
> = {
  CATEGORY_NOT_FOUND: 'Sals3 category not found',
  TAXONOMY_PRESET_UNAVAILABLE: 'No taxonomy preset for this category',
};

export type CategoryFormContract =
  | {
      outcome: 'CATEGORY_FORM_CONTRACT';
      categoryCode: string;
      categoryPath: string;
      taxonomyVersion: string;
      /** Verbatim workbook value, kept so a reviewer sees the source wording. */
      variationArchitecture: string | null;
      variationTiers: VariationTierCount;
      tier1Attribute: string | null;
      tier2Attribute: string | null;
      skuFormatStandard: string | null;
      /** The allow list. An attribute not named here is never accepted as a known field. */
      requiredAttributes: readonly string[];
      source: {
        workbook: string;
        sheet: string;
        checksum: string;
      };
      contractVersion: string;
    }
  | {
      outcome: 'CATEGORY_FORM_UNAVAILABLE';
      reason: CategoryFormUnavailableReason;
      reasonLabel: string;
      contractVersion: string;
    };

export type CategoryAttributeFindingCode =
  | 'REQUIRED_ATTRIBUTE_MISSING'
  | 'REQUIRED_ATTRIBUTE_BLANK'
  | 'UNRECOGNIZED_ATTRIBUTE_PRESERVED'
  | 'VARIATION_ARCHITECTURE_UNRECOGNIZED';

export const CATEGORY_ATTRIBUTE_FINDING_LABELS: Record<
  CategoryAttributeFindingCode,
  string
> = {
  REQUIRED_ATTRIBUTE_MISSING: 'Required attribute is missing',
  REQUIRED_ATTRIBUTE_BLANK: 'Required attribute is empty',
  UNRECOGNIZED_ATTRIBUTE_PRESERVED:
    'Attribute is not in this category preset and was kept for review',
  VARIATION_ARCHITECTURE_UNRECOGNIZED:
    'Variation architecture could not be read from the taxonomy preset',
};

export type CategoryAttributeFinding = {
  code: CategoryAttributeFindingCode;
  label: string;
  attributeName: string | null;
};

/**
 * `NEEDS_REVIEW` never means "rejected" and never means "fixed". Nothing here
 * substitutes a default, and `unrecognizedAttributes` keeps every value the
 * preset did not know about instead of dropping it to make the form pass.
 */
export type CategoryAttributeValidation = {
  outcome: 'VALID' | 'NEEDS_REVIEW';
  categoryCode: string;
  taxonomyVersion: string;
  acceptedAttributes: Readonly<Record<string, string>>;
  missingRequiredAttributes: readonly string[];
  unrecognizedAttributes: ReadonlyArray<{ name: string; value: string }>;
  findings: readonly CategoryAttributeFinding[];
  contractVersion: string;
};
