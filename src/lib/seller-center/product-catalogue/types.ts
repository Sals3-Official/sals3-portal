import type { MoneyValue } from '@/lib/seller-center/product-editor/types';

/**
 * Types for the Product Catalogue design preview ("Product Catalogue" nav
 * item under Dropship Catalogue).
 *
 * Design-only, same posture as `product-editor/types.ts`: nothing here
 * reads a database. Sals3 has no Product/Variant/Offer table yet (see
 * [[cj-candidate-to-sals3-product-draft-implementation-spec]] and `hot.md`'s
 * "no writable Sals3 catalogue exists yet").
 *
 * Unlike the first version of this preview, every field here matches an
 * approved decision rather than an invented retail-catalogue concept:
 *
 * - `ListingStatus` is ADR-011's five-state lifecycle, not a generic
 *   Active/Inactive/Draft/Pending QC/Violation/Deleted set. There is no
 *   `DELETED` state - Archive is the safe lifecycle action, and product,
 *   revision, supplier evidence, audit, and accepted-order references stay
 *   recoverable (see [[ADR-007-supplier-change-attention-and-immutable-order-snapshots]]).
 * - `Availability` is dropshipping source-health truth (ADR-013), separate
 *   from listing status - a listing can be `LIVE` while one variant is
 *   `OUT_OF_STOCK` and the rest stay purchasable.
 * - `MediaStatus` uses ADR-011's exact labels
 *   (`OWN_PICTURES`/`SUPPLIER_PICTURES`/`MIXED_PICTURES`/`SUPPLIER_FALLBACK`/
 *   `NEEDS_MEDIA_REVIEW`/`NO_USABLE_PICTURES`), also independent of listing
 *   status.
 * - Sals3 identity (`sals3ProductId`/`sals3VariantId`) is canonical; CJ
 *   identifiers are supplier references, never presented as "Product ID."
 * - Supplier-reported stock is read-only evidence, never an editable
 *   number - see `supplierObservedQuantity` below.
 *
 * Units sold, wishlist adds, page views, and star ratings have no backend
 * anywhere in this repo and are intentionally omitted rather than rendered
 * as fictional numbers (see `hot.md`'s standing rule against fabricated
 * public figures). A lightweight "content readiness" concept remains as a
 * non-blocking preview signal only - it never substitutes for a hard
 * publication gate.
 */

/**
 * ADR-011 listing lifecycle. Independent of availability and media status.
 */
export const LISTING_STATUSES = [
  'DRAFT',
  'LIVE',
  'LIVE_NEEDS_ATTENTION',
  'AUTO_PAUSED',
  'ARCHIVED',
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  DRAFT: 'Draft',
  LIVE: 'Live',
  LIVE_NEEDS_ATTENTION: 'Live · Needs Attention',
  AUTO_PAUSED: 'Auto-paused',
  ARCHIVED: 'Archived',
};

/**
 * Availability/source-health truth (ADR-013 §1, handoff dimension B).
 * `SOME_VARIANTS_UNAVAILABLE` and `AVAILABLE` are the two states a product
 * with variants derives from its own variant list - see `derive.ts`.
 */
export const AVAILABILITY_STATES = [
  'AVAILABLE',
  'SOME_VARIANTS_UNAVAILABLE',
  'OUT_OF_STOCK',
  'SUPPLIER_CHECK_PENDING',
  'SUPPLIER_DISCONNECTED',
  'MARKET_UNAVAILABLE',
  'UNKNOWN_OR_STALE',
] as const;

export type Availability = (typeof AVAILABILITY_STATES)[number];

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  AVAILABLE: 'Available',
  SOME_VARIANTS_UNAVAILABLE: 'Some variants unavailable',
  OUT_OF_STOCK: 'Out of stock',
  SUPPLIER_CHECK_PENDING: 'Supplier check pending',
  SUPPLIER_DISCONNECTED: 'Supplier disconnected',
  MARKET_UNAVAILABLE: 'Market unavailable',
  UNKNOWN_OR_STALE: 'Unknown or stale',
};

/**
 * Raw supplier stock evidence (ADR-013 §1). Kept separate from
 * `Availability` - which is the derived, checkout-relevant truth - so a
 * factory-backed or unverified observation is never silently collapsed
 * into a pass/fail boolean.
 */
export const STOCK_EVIDENCE_KINDS = [
  'CJ_WAREHOUSE_STOCK',
  'FACTORY_BACKED_STOCK',
  'MIXED_STOCK',
  'ZERO_STOCK',
  'UNKNOWN_STOCK',
] as const;

export type StockEvidenceKind = (typeof STOCK_EVIDENCE_KINDS)[number];

export const STOCK_EVIDENCE_LABELS: Record<StockEvidenceKind, string> = {
  CJ_WAREHOUSE_STOCK: 'CJ warehouse stock',
  FACTORY_BACKED_STOCK: 'Factory-backed stock',
  MIXED_STOCK: 'Mixed warehouse/factory stock',
  ZERO_STOCK: 'Zero stock observed',
  UNKNOWN_STOCK: 'Stock unknown',
};

/** ADR-011's exact catalogue media-status labels. */
export const MEDIA_STATUSES = [
  'OWN_PICTURES',
  'SUPPLIER_PICTURES',
  'MIXED_PICTURES',
  'SUPPLIER_FALLBACK',
  'NEEDS_MEDIA_REVIEW',
  'NO_USABLE_PICTURES',
] as const;

export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MEDIA_STATUS_LABELS: Record<MediaStatus, string> = {
  OWN_PICTURES: 'Own pictures',
  SUPPLIER_PICTURES: 'Supplier pictures',
  MIXED_PICTURES: 'Mixed pictures',
  SUPPLIER_FALLBACK: 'Supplier fallback',
  NEEDS_MEDIA_REVIEW: 'Needs media review',
  NO_USABLE_PICTURES: 'No usable pictures',
};

/** ADR-007's notification severities, reused for the Attention column. */
export const ATTENTION_SEVERITIES = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
] as const;

export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export const ATTENTION_SEVERITY_LABELS: Record<AttentionSeverity, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

/** One unresolved attention reason, matching ADR-007's `AttentionIssue` shape. */
export type AttentionReasonFixture = {
  id: string;
  severity: AttentionSeverity;
  reasonCode: string;
  summary: string;
  /** Whether new checkout is currently allowed for the affected scope. */
  checkoutAllowed: boolean;
};

export type CatalogueVariantFixture = {
  id: string;
  /** e.g. "Color: Green, Size: Medium 31-35". */
  optionLabel: string;
  /** Canonical Sals3 sellable identity - never a CJ id. */
  sals3VariantId: string;
  sellerSku: string;
  /** Supplier reference only, shown read-only. */
  cjVariantId: string;
  hasImage: boolean;
  /** Seller-managed customer-facing price. */
  sellingPrice: MoneyValue;
  /** Observed supplier fact, never the customer price. */
  supplierCost: MoneyValue;
  availability: Availability;
  stockEvidence: StockEvidenceKind;
  /** Supplier-reported/observed only - never a guaranteed customer promise. Null when unknown/stale. */
  supplierObservedQuantity: number | null;
  lastCheckedAt: string;
  /**
   * Fixed fixture classification rather than a `now`-relative computation:
   * this screen server-renders once and hydrates client-side, and
   * `product-editor/format.ts` already documents why a `Date.now()`-derived
   * value here would risk a hydration mismatch at a threshold boundary.
   */
  evidenceFreshness: EvidenceFreshness;
  /** Manual seller pause, independent of supplier-driven availability. */
  manuallyPaused: boolean;
};

export type CatalogueProductFixture = {
  id: string;
  /** Canonical Sals3 catalog identity - never a CJ id. */
  sals3ProductId: string;
  name: string;
  hasImage: boolean;
  status: ListingStatus;
  categoryPath: string;
  createdAt: string;
  supplierProviderCode: string;
  supplierProviderName: string;
  /** Supplier reference only, shown read-only, never labelled "Product ID". */
  cjProductId: string;
  /** Seller-managed customer-facing price for a single-offer product. */
  sellingPrice: MoneyValue;
  /**
   * Fallback source-health facts for a single-offer product with no
   * variant list. When `variants.length > 0`, the product's real
   * availability/freshness is always derived from those variants
   * (`derive.ts`) rather than read from these fields directly.
   */
  availability: Availability;
  stockEvidence: StockEvidenceKind;
  supplierObservedQuantity: number | null;
  lastCheckedAt: string;
  evidenceFreshness: EvidenceFreshness;
  mediaStatus: MediaStatus;
  contentReadiness: 'TOP' | 'GOOD' | 'NEEDS_IMPROVEMENT';
  /** Populated only when `status === 'AUTO_PAUSED'` - manual or system-driven, always stated. */
  pauseReason: string | null;
  /** Present only when `status === 'LIVE' || status === 'LIVE_NEEDS_ATTENTION'` and a real storefront URL exists. */
  storefrontUrl: string | null;
  attentionReasons: AttentionReasonFixture[];
  /** Links "Edit" to a real fixture already built in the Product Editor. */
  editorFixtureKey: string;
  variants: CatalogueVariantFixture[];
};

export const CONTENT_READINESS_LABELS: Record<
  CatalogueProductFixture['contentReadiness'],
  string
> = {
  TOP: 'Top',
  GOOD: 'Good',
  NEEDS_IMPROVEMENT: 'Needs improvement',
};

export type CatalogueSortKey =
  'CREATED_DESC' | 'PRICE_ASC' | 'PRICE_DESC' | 'ATTENTION_SEVERITY_DESC';

export const CATALOGUE_SORT_LABELS: Record<CatalogueSortKey, string> = {
  CREATED_DESC: 'Newest first',
  PRICE_ASC: 'Price: low to high',
  PRICE_DESC: 'Price: high to low',
  ATTENTION_SEVERITY_DESC: 'Most urgent attention first',
};

export type CatalogueSearchField =
  'NAME' | 'SALS3_PRODUCT_ID' | 'SELLER_SKU' | 'SUPPLIER_REFERENCE';

export const CATALOGUE_SEARCH_FIELD_LABELS: Record<
  CatalogueSearchField,
  string
> = {
  NAME: 'Product name',
  SALS3_PRODUCT_ID: 'Sals3 Product ID',
  SELLER_SKU: 'Seller SKU',
  SUPPLIER_REFERENCE: 'Supplier reference (CJ ID)',
};

export type EvidenceFreshness = 'FRESH' | 'STALE' | 'UNKNOWN';

export const EVIDENCE_FRESHNESS_LABELS: Record<EvidenceFreshness, string> = {
  FRESH: 'Fresh',
  STALE: 'Stale',
  UNKNOWN: 'Unknown',
};
