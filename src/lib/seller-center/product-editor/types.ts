import type { DescriptionBlock } from '@/lib/products/description-blocks';
import type { DescriptionMode } from '@/lib/products/simple-description';
import type {
  AssignableMediaFixture,
  MappedOptionAxis,
} from '@/lib/seller-center/product-catalogue/types';
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
  | 'specification'
  | 'description'
  | 'variants'
  | 'markets'
  | 'specs'
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

/** One supplier variant. Editor stores product cost, retail price, stock, and seller listing state. */
export type VariantFixture = {
  id: string;
  optionLabel: string;
  sellerSku: string;
  supplierCost: MoneyValue;
  retailPrice: MoneyValue;
  supplierStock: number;
  warehouseLabel: string;
  hasImage: boolean;
  /**
   * The photo recorded for this variant, and the media row that holds it.
   *
   * `hasImage` alone could only draw a placeholder. Both are optional so the
   * illustrative fixtures, which carry no imagery at all, stay valid.
   */
  imageUrl?: string | null;
  imageMediaId?: string | null;
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

/** Eligibility evidence for one destination market the seller actually has enabled. */
export type MarketEvidenceFixture = {
  code: string;
  name: string;
  /** Fixture markets are labelled as samples; database-backed markets are real seller profile destinations. */
  isSampleMarket: boolean;
  eligibility: MarketEligibility;
  affectedVariantsLabel: string;
  packageWeightLabel: string;
  evidenceCapturedAt: string;
  note: string | null;
};

/** The media-rights check. Never conflated with `MediaStorageState`. */
export type MediaRightsCheck = 'VERIFIED' | 'PENDING_VERIFICATION' | 'REJECTED';

/**
 * Where the file lives. `SALS3_STORED` is the one state that says Sals3 holds
 * an actual copy - reserved for a real `SELLER_UPLOAD` row, since nothing
 * else in this repository copies media into Sals3-controlled storage today.
 */
export type MediaStorageState =
  | 'SUPPLIER_HOSTED_SOURCE'
  | 'SALS3_STORED'
  | 'PENDING_IMPORT'
  | 'STORAGE_STATUS_UNAVAILABLE';

/**
 * Mirrors `product_media_sources.source_type` (ADR-011 §1). Declared locally
 * rather than imported from `src/lib/db/schema`, same reasoning as
 * `SupplierConnectionStatus` above.
 */
export type MediaSourceType = 'SUPPLIER_ORIGINAL' | 'SELLER_UPLOAD';

export type MediaItemFixture = {
  id: string;
  label: string;
  /**
   * The image address to render, host-checked by whoever built this item.
   *
   * `null` on the illustrative fixtures — no product imagery is supplied with
   * them, and inventing a remote address for a fictional product would put a
   * real supplier's photo behind a made-up listing. A tile with no address
   * renders its label in a placeholder box instead.
   */
  sourceUrl: string | null;
  /** Meaningful alternative text. Required whenever `sourceUrl` is set. */
  altText: string;
  rightsCheck: MediaRightsCheck;
  storageState: MediaStorageState;
  /**
   * `SUPPLIER_ORIGINAL` items are read-only provenance (Supplier Details,
   * `ProductEditorFixture.supplierMedia`) - never reorderable and never
   * eligible for `isCover`/`onMakeCover`. `SELLER_UPLOAD` items are the
   * seller's own (`ProductEditorFixture.media`), the only ones Media section
   * controls may touch.
   */
  sourceType: MediaSourceType;
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

export type CategoryAttributeInputControlType =
  | 'SINGLE_SELECT_DROPDOWN'
  | 'MULTI_SELECT_DROPDOWN'
  | 'TEXT_INPUT'
  | 'NUMBER_INPUT'
  | 'MEASUREMENT_INPUT'
  | 'BOOLEAN_TOGGLE'
  | 'DATE_PICKER';

/**
 * One category-driven attribute control, already joined with whatever the
 * seller has stored for it (the Specification section - distinct from
 * `SpecificationFixture` above, which is the unrelated, read-only Supplier
 * Details tab).
 *
 * `unresolved` follows the same rule as `SpecificationFixture.unresolved`:
 * `REQUIRED` empty is a hard blocker, `RECOMMENDED` empty is a warning,
 * `OPTIONAL` empty is neither - reused by `severityForUnresolvedSpecification`
 * conceptually, not by import, since the two fixtures are different shapes.
 */
export type CategoryAttributeFieldFixture = {
  attributeName: string;
  requirement: SpecificationRequirement;
  inputControlType: CategoryAttributeInputControlType;
  allowedValues: readonly string[];
  allowCustomValue: boolean;
  allowMultipleValues: boolean;
  sellerHelpText: string | null;
  values: readonly string[];
  isCustomValue: boolean;
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
  /** Seller-facing draft L1 selection. Display only, not a leaf category id. */
  sals3CategoryL1: string | null;
  /**
   * The stable Sals3 universal category code (ADR-002) `sals3CategoryPath`
   * displays. `null` when unmapped — pricing guidance requires this, a
   * display label is never an acceptable substitute for it.
   */
  sals3CategoryCode: string | null;
  categoryMappingConfidence: CategoryMappingConfidence;
  /**
   * True only when this exact product's own category came from a seller
   * explicitly deciding it via the category picker (`decideProductSals3Category`
   * writes a category with no `categoryMappingId` behind it — see
   * `read-model.ts`'s `sellerDeclaredSals3Category`). `categoryMappingConfidence`
   * above cannot answer this: the pre-existing CJ auto-mirror
   * (`cj-mirror.ts`) already resolves `EXACT`/`ACCEPTABLE` confidence for
   * almost every CJ-sourced product with no seller ever having decided
   * anything, so gating the "no category decided yet" reminder on
   * confidence alone made it a no-op for real products. The reminder is a
   * `WARNING`, not a `BLOCKER` (owner decision 2026-08-15) — never disables
   * publishing, since a missing decision is the seller's own business risk,
   * not a technical gate, and every already-live product predates this
   * picker.
   */
  sals3CategoryDeclaredBySeller: boolean;
  /**
   * The real, persisted `supplier_candidates.id` this draft would be keyed
   * to for a product/variant pricing override. `null` for every fixture in
   * this design preview — nothing here corresponds to a real candidate, so
   * a product/variant override action has nothing real to attach to yet.
   */
  realSupplierCandidateId: string | null;
  sellerSku: string;
  brandDeclaration: string;
  /**
   * The stored description document's blocks, in render order.
   *
   * The editor edits these directly. It used to be handed `descriptionText`
   * alone and re-parse it into paragraphs on save, which rewrote every
   * heading, bullet list, and detail list a document held into prose the
   * first time anyone opened the page.
   */
  descriptionBlocks: DescriptionBlock[];
  /**
   * Which description editor the seller last chose. `undefined` for a document
   * written before the field existed, which the editor infers from content.
   */
  descriptionMode?: DescriptionMode;
  /**
   * The stored Variant Matrix, for renaming what a buyer reads. Empty until
   * the product is mapped.
   */
  mappedAxes: MappedOptionAxis[];
  /** The lossy plain-text projection of `descriptionBlocks`. Never saved back. */
  descriptionText: string;
  /**
   * The seller-edited page meta description (`products.metaDescription`) —
   * hidden search/AI-discovery copy, distinct from `descriptionText` above.
   * `''` when nothing has been saved yet, the same "not set" convention
   * `descriptionText` already uses.
   */
  metaDescriptionText: string;
  source: SupplierSourceIdentity;
  evaluationStatus: EvaluationStatus;
  listingState: ListingLifecycleState;
  completionPercent: number;
  lastValidatedAt: string;
  sourceProductStatus: SourceProductStatus;
  banner: EditorBanner | null;
  issues: ReadinessIssue[];
  sourceChanges: SourceChangeFixture[];
  /**
   * When the supplier evidence `sourceChanges` was computed against was captured.
   * `null` when none is stored.
   *
   * Carried separately because it is what an *empty* list needs. No differences
   * is a statement about one snapshot on one date, and nothing refreshes that
   * snapshot on a schedule — so the panel must be able to say which date, rather
   * than implying the supplier has stood still.
   */
  sourceChangesCapturedAt: string | null;
  specifications: SpecificationFixture[];
  /**
   * Category-driven attribute controls for the Specification section.
   * Empty when the resolved category has no controls for the active
   * extraction yet - render nothing, not a placeholder.
   */
  categoryAttributes: CategoryAttributeFieldFixture[];
  /** Which extraction `categoryAttributes` was resolved against. `null` when there are none. */
  categoryAttributesControlsVersion: string | null;
  /**
   * What the supplier's concatenated variant labels encode, and whether a seller
   * has already named it.
   *
   * `proposal` is derived, never authoritative: it reports how many positions the
   * labels contain and which supplier tokens sit at each, and deliberately does
   * not name them. Nothing in CJ's payload says position 0 is a "Colour" — on a
   * phone the same two slots could be plug type and storage — so names come only
   * from a person. An empty `proposal` means the labels do not form a clean grid,
   * which is a normal answer, not an error.
   *
   * A non-empty `mappedAxisNames` means the mapping is already committed and the
   * section reports rather than edits: `saveOptionMapping` is insert-only and
   * refuses to re-map.
   */
  optionMapping: {
    proposal: { index: number; values: string[] }[];
    mappedAxisNames: string[];
    /**
     * Category-derived axis names aligned index-for-index with `proposal`, from
     * the taxonomy workbook's variation families.
     *
     * `null` at a position means the category offers no suggestion for that axis
     * (no family recorded, or a third supplier position the two-tier taxonomy
     * does not describe). They are *offered*, never pre-filled: the workbook
     * knows the category but cannot know which supplier position holds which
     * attribute, so a person accepts the suggestion and the saved mapping stays
     * theirs. See `modules/catalog/taxonomy/variation-families.ts`.
     */
    /** Every name the workbook offers per axis, not only the first. */
    suggestedAxisNames: string[][];
    /**
     * Whether leaving this unmapped actually blocks publication.
     *
     * True only for a concatenated label (two or more supplier token positions).
     * A single-axis product is nameable but publishes either way, so the section
     * must not claim a blocker the server would never raise. See
     * `optionMappingRequiredButMissing` in `modules/catalog/products/publish.ts`.
     */
    mappingBlocksPublish: boolean;
    variantCount: number;
    /**
     * Variants whose supplier label was never recorded.
     *
     * A single one of these empties `proposal`, because `deriveOptionSplit`
     * refuses when any variant lacks a label. So this is what separates "the
     * supplier's labels genuinely do not form a grid" from "the labels were never
     * written down" — two states that look identical in the editor, and only the
     * second of which can be repaired.
     */
    unlabelledVariantCount: number;
  };
  variants: VariantFixture[];
  markets: MarketEvidenceFixture[];
  /** Markets not enabled for this seller - stated, never rendered as evidence. */
  marketsNotEnabledCount: number;
  /** The seller's own uploaded photos only (ADR-011). Editable in Media section. */
  media: MediaItemFixture[];
  /**
   * The supplier's own photos (or the feed's bare `imageUrl` when no
   * `product_media_sources` row exists yet) - read-only provenance shown in
   * Basic Information's Supplier Details, never in Media section.
   */
  supplierMedia: MediaItemFixture[];
  /**
   * Every stored photo a variant can be pointed at, with the real media row id
   * the assignment writes to. Empty on the illustrative fixtures, which carry
   * no imagery — the picker then explains that instead of offering nothing.
   */
  assignableMedia?: AssignableMediaFixture[];
  /**
   * Whether `supplierMedia` shows to buyers alongside `media`, not only as a
   * fallback when `media` is empty. Off hides the supplier's photo from
   * every buyer-facing surface (header thumbnail, Draft Storefront Preview,
   * publish); `media` still shows regardless. Supplier Details' read-only
   * evidence gallery is unaffected either way — that is provenance, never
   * buyer-facing.
   */
  showSupplierPhoto: boolean;
  policyVersion: string;
  /** Present only for database-backed rows whose open draft can be saved. */
  draftSaveTarget: {
    productId: string;
    revisionId: string;
    expectedRevisionVersion: number;
  } | null;
  publishTarget: {
    productId: string;
    expectedProductVersion: number;
  } | null;
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
  { id: 'specification', label: 'Specification' },
  { id: 'description', label: 'Description' },
  { id: 'variants', label: 'Variants & Pricing' },
  { id: 'markets', label: 'Markets' },
  { id: 'specs', label: 'Supplier Details' },
  { id: 'review', label: 'Review & Publish' },
];
