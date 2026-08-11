import type {
  EvaluationStatus,
  ReasonCode,
} from '@/modules/catalog/candidates/rules/contracts';
import type { PricingDecision } from '@/modules/pricing/types';

/**
 * Types for the Product Editor ("Add Product" prefilled from a qualified
 * supplier candidate).
 *
 * Design-only for now: the fixtures in
 * `src/lib/seller-center/mock-data/product-editor.ts` are fictional and
 * nothing here reads a database, a Drizzle schema, a Supplier App adapter,
 * or the evaluation pipeline. The vocabulary deliberately reuses the *real*
 * enums already decided elsewhere in this repo - the seven evaluation
 * decision states and the reason codes from
 * `src/modules/catalog/candidates/rules/contracts.ts` - so this reads as
 * "the same product, a richer screen" rather than a parallel design
 * language.
 *
 * Two rules are structural rather than cosmetic, and the component layer
 * depends on them:
 *
 * 1. No provider name appears in a type or field name. CJ Dropshipping is
 *    the current fixture provider; swapping in another supplier must not
 *    require touching an editor component (ADR-008's installable Supplier
 *    Apps).
 * 2. No currency appears in a field name, and every monetary value carries
 *    its own currency. There is no approved FX source for this screen, so
 *    values in different currencies are never added, compared, or
 *    converted - a missing figure stays `null` and renders as words, never
 *    as `0`.
 */

/** Integer minor units plus the ISO currency they are denominated in. */
export type MoneyValue = {
  amountMinor: number;
  currency: string;
};

/**
 * Mirrors the real `supplier_connection_status` values. Declared locally
 * rather than imported from `src/lib/db/schema` so this module stays free
 * of Drizzle and safe to import from a Client Component.
 */
export type SupplierConnectionStatus =
  'CONNECTED' | 'DEGRADED' | 'REAUTH_REQUIRED' | 'DISCONNECTED' | 'REVOKED';

/**
 * Which supplier account this draft was sourced from. Identity only - a
 * credential, token, or secret must never reach this type, because every
 * field on it is rendered somewhere in the editor.
 */
export type SupplierSourceIdentity = {
  providerId: string;
  providerCode: string;
  providerDisplayName: string;
  /** Repo-local asset (`/suppliers/...`); absent providers fall back to a generic icon. */
  providerLogoPath?: string;
  connectionId: string;
  connectionDisplayName: string;
  connectionStatus: SupplierConnectionStatus;
  externalProductId: string;
  sourceCurrency: string;
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
};

/** Where a field's current value came from, shown as a per-field badge. */
export type FieldSource = 'SUPPLIER' | 'SELLER' | 'INFERRED' | 'NOT_PROVIDED';

export type IssueSeverity = 'BLOCKER' | 'WARNING' | 'SUGGESTION';

export type EditorSectionId =
  | 'basic'
  | 'specs'
  | 'description'
  | 'variants'
  | 'markets'
  | 'media'
  | 'review';

export type IssueSource =
  'AUTOMATED_VALIDATION' | 'SUPPLIER_CHANGE' | 'SUGGESTION';

export type ReadinessIssue = {
  id: string;
  severity: IssueSeverity;
  title: string;
  explanation: string;
  /** Which market / variant / media item / field this is about. */
  affectedScope: string;
  source: IssueSource;
  section: EditorSectionId;
  /** Present when the issue maps onto a real pipeline reason code. */
  reasonCode: ReasonCode | null;
  /** Plain-language resolution path. `PERMANENT_REASON_CODES` have none. */
  resolution: string;
};

export type VariantListingState =
  'WILL_LIST' | 'NOT_LISTED' | 'BLOCKED' | 'PAUSED';

/**
 * One supplier variant. Landed cost and margin are deliberately *absent* -
 * they are derived in `derive.ts` so a missing freight estimate propagates
 * to "Not available" everywhere instead of being stored as a zero.
 */
export type VariantFixture = {
  id: string;
  optionLabel: string;
  sellerSku: string;
  supplierCost: MoneyValue;
  /** `null` renders as "Needs route check" - no route evidence, not free freight. */
  freightEstimate: MoneyValue | null;
  retailPrice: MoneyValue;
  supplierStock: number;
  warehouseLabel: string;
  hasImage: boolean;
  enabled: boolean;
  listingState: VariantListingState;
  /** Short attention label for the table's Attention column. */
  attention: string | null;
  supplierVariantId: string;
  packedWeightGrams: number;
  evidenceCapturedAt: string;
};

export type MarketEligibility =
  'ELIGIBLE' | 'ELIGIBLE_STALE_EVIDENCE' | 'NO_ROUTE' | 'BLOCKED';

/**
 * Shipping evidence for one destination market the seller actually has
 * enabled. Markets the seller has *not* enabled are never modelled here -
 * they would render as an evidence card for a market that is not part of
 * this listing's configuration. They are carried as a plain count on
 * `ProductEditorFixture.marketsNotEnabledCount` and stated in one neutral
 * sentence instead.
 */
export type MarketEvidenceFixture = {
  code: string;
  name: string;
  /** Always true: no destination market is approved yet (ADR-003). */
  isSampleMarket: true;
  eligibility: MarketEligibility;
  affectedVariantsLabel: string;
  sourceWarehouse: string;
  packageWeightLabel: string;
  packageDimensionsLabel: string | null;
  routeEvidence: string;
  /** `null` when no route evidence exists - never a zero freight. */
  freightEstimate: { min: MoneyValue; max: MoneyValue } | null;
  deliveryRangeLabel: string | null;
  evidenceCapturedAt: string;
  note: string | null;
};

/** The media-rights check. Never conflated with `MediaStorageState`. */
export type MediaRightsCheck = 'VERIFIED' | 'PENDING_VERIFICATION' | 'REJECTED';

/**
 * Where the file lives. Nothing copies media into Sals3-controlled storage
 * today, so no value here may imply that it has.
 */
export type MediaStorageState =
  'SUPPLIER_HOSTED_SOURCE' | 'PENDING_IMPORT' | 'STORAGE_STATUS_UNAVAILABLE';

export type MediaItemFixture = {
  id: string;
  label: string;
  rightsCheck: MediaRightsCheck;
  storageState: MediaStorageState;
  pixelWidth: number;
  pixelHeight: number;
  note: string | null;
  isCover: boolean;
};

/**
 * Drives severity when the attribute has no value, and nothing else:
 * `REQUIRED` unresolved is a hard blocker, `RECOMMENDED` unresolved is a
 * warning, `OPTIONAL` unresolved is a suggestion. A truly required
 * attribute is never presented as a publishable warning.
 */
export type SpecificationRequirement = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';

export type SpecificationFixture = {
  key: string;
  label: string;
  value: string;
  requirement: SpecificationRequirement;
  source: FieldSource;
  /**
   * No supplier value and no seller value yet. A `REQUIRED` unresolved
   * attribute is a hard blocker; a `RECOMMENDED` one is a warning.
   */
  unresolved: boolean;
};

/**
 * One supplier-side change since the candidate was first evaluated. The
 * two impact fields are kept separate on purpose (ADR-007): a supplier
 * change may alter the current listing, and never rewrites an accepted
 * order's immutable `OrderLineSnapshot`.
 */
export type SourceChangeFixture = {
  id: string;
  title: string;
  body: string;
  occurredAt: string;
  currentListingImpact: string;
  acceptedOrderImpact: string;
  listingAutoPaused: boolean;
  sellerActionRequired: boolean;
};

export type ListingLifecycleState = 'DRAFT' | 'PUBLISHED' | 'PUBLISHED_PAUSED';

export type SourceProductStatus = 'LISTED_BY_SUPPLIER' | 'DELISTED_BY_SUPPLIER';

export type EditorBanner = {
  tone: 'warning' | 'danger';
  title: string;
  body: string;
};

/** ADR-002's four mapping-confidence states. `AMBIGUOUS`/`UNMAPPED` never receive category-policy price guidance — see `src/modules/pricing/resolver.ts`. */
export type CategoryMappingConfidence =
  'EXACT' | 'ACCEPTABLE' | 'AMBIGUOUS' | 'UNMAPPED';

export type ProductEditorFixture = {
  /** Development fixture key, e.g. `pass`. Never a real candidate id. */
  fixtureKey: string;
  scenarioLabel: string;
  /** Seller-facing "Product Name". The internal field name is never shown. */
  productName: string;
  supplierProductName: string;
  supplierCategoryPath: string;
  sals3CategoryPath: string;
  /**
   * The stable Sals3 universal category code (ADR-002) `sals3CategoryPath`
   * displays. `null` when unmapped — pricing guidance requires this, a
   * display label is never an acceptable substitute for it.
   */
  sals3CategoryCode: string | null;
  categoryMappingConfidence: CategoryMappingConfidence;
  /**
   * The real, persisted `supplier_candidates.id` this draft would be keyed
   * to for a product/variant pricing override. `null` for every fixture in
   * this design preview — nothing here corresponds to a real candidate, so
   * a product/variant override action has nothing real to attach to yet.
   */
  realSupplierCandidateId: string | null;
  sellerSku: string;
  brandDeclaration: string;
  descriptionText: string;
  source: SupplierSourceIdentity;
  evaluationStatus: EvaluationStatus;
  listingState: ListingLifecycleState;
  completionPercent: number;
  lastValidatedAt: string;
  sourceProductStatus: SourceProductStatus;
  banner: EditorBanner | null;
  issues: ReadinessIssue[];
  sourceChanges: SourceChangeFixture[];
  specifications: SpecificationFixture[];
  variants: VariantFixture[];
  markets: MarketEvidenceFixture[];
  /** Markets not enabled for this seller - stated, never rendered as evidence. */
  marketsNotEnabledCount: number;
  media: MediaItemFixture[];
  policyVersion: string;
  /** Opaque internal identifiers only. Never a key, token, or secret. */
  advancedIdentifiers: Record<string, string>;
};

/**
 * Local UI state of the prototype's save/validation lifecycle. Every value
 * is demonstrated in-tab only: nothing here corresponds to a request, and
 * refreshing the page resets it.
 */
export type EditorLifecycle =
  | 'IDLE'
  | 'SAVING'
  | 'SAVED'
  | 'SAVE_FAILED'
  | 'VALIDATING'
  | 'VALIDATION_FAILED'
  | 'CONNECTION_UNAVAILABLE'
  | 'SESSION_EXPIRED';

/**
 * One variant's server-resolved pricing guidance (`resolveProductPricing`).
 * `decision` is `null` only when the resolver itself could not run (e.g.
 * the pricing-policy tables are not migrated in this environment yet) —
 * distinct from a real `PRICING_UNAVAILABLE` outcome, but rendered the
 * same neutral way so the editor never crashes on a missing schema.
 */
export type VariantPricingGuidance = {
  variantId: string;
  optionLabel: string;
  decision: PricingDecision | null;
};

export const EDITOR_SECTIONS: ReadonlyArray<{
  id: EditorSectionId;
  label: string;
}> = [
  { id: 'basic', label: 'Basic Information' },
  { id: 'specs', label: 'Category & Specifications' },
  { id: 'description', label: 'Description' },
  { id: 'variants', label: 'Variants & Pricing' },
  { id: 'markets', label: 'Markets & Shipping' },
  { id: 'media', label: 'Media' },
  { id: 'review', label: 'Review & Publish' },
];
