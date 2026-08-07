/**
 * Design-preview-only types for the "All Supplier Products" redesign.
 *
 * These intentionally reuse the *real* enum values already decided elsewhere
 * in this codebase (`supplier_connection_status`, the automated evaluation
 * pipeline's seven decision states) rather than inventing new vocabulary, so
 * this prototype reads as "the same product, a better view" instead of a
 * parallel design language. See `src/lib/db/schema/supplier-connections.ts`
 * and `src/modules/catalog/candidates/rules/contracts.ts` for the source of
 * truth this mirrors.
 *
 * Nothing here touches Drizzle, a migration, or a real table - nothing in
 * this file or its siblings under `all-supplier-products/` is imported by
 * production code.
 */

export type SupplierConnectionStatus =
  | 'PENDING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'REAUTH_REQUIRED'
  | 'DISCONNECTED'
  | 'REVOKED';

/**
 * The real pipeline's seven decision states, plus `null` for "not yet
 * discovered by the pipeline at all" (the existing `presentEvaluationStatus`
 * pattern's `NOT_TRACKED` case).
 */
export type EvaluationStatus =
  | 'QUEUED'
  | 'EVALUATING'
  | 'PASS'
  | 'PASS_WITH_ATTENTION'
  | 'TEMPORARILY_INELIGIBLE'
  | 'BLOCKED'
  | 'EVALUATION_FAILED';

export type StockAvailability =
  'IN_STOCK' | 'PARTIAL_VARIANT_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';

/** A seller's own connection to one curated Supplier App (ADR-008). */
export type SupplierConnectionFixture = {
  id: string;
  providerCode: string;
  providerDisplayName: string;
  /** Short mark shown in a logo chip when no real asset exists (fixture-only providers). */
  providerLogoInitial: string;
  connectedAccountLabel: string;
  status: SupplierConnectionStatus;
  lastVerifiedAt: string | null;
};

/**
 * A live fetch failure against an otherwise-connected supplier - distinct
 * from `SupplierConnectionFixture.status`, because a `CONNECTED` connection
 * can still have a transient upstream outage (spec section 10's "CJ is
 * healthy, AliExpress is temporarily unavailable" example).
 */
export type SupplierFetchFailure = {
  connectionId: string;
  lastSuccessfulSyncAt: string;
};

export type SupplierProductFixture = {
  id: string;
  connectionId: string;
  externalProductId: string;
  externalVariantIds: string[];
  title: string;
  /** Seller-facing normalized name, when one has been derived. Not every row has one. */
  normalizedTitle: string | null;
  imageUrl: string | null;
  category: string;
  supplierCurrency: string;
  supplierPriceMinor: number;
  supplierPriceMaxMinor: number | null;
  stock: StockAvailability;
  availableVariantCount: number | null;
  totalVariantCount: number | null;
  shipsFrom: string[];
  /**
   * Destination markets this product could currently ship to, restricted to
   * the seller's own enabled + policy-approved markets
   * (`src/lib/seller-center/market-config.ts`'s illustrative PH/ID/SG set) -
   * never an invented country list.
   */
  eligibleMarkets: string[];
  evaluationStatus: EvaluationStatus | null;
  evaluationReasonCodes: string[];
  lastSupplierUpdateAt: string;
  lastSyncedAt: string;
  isStale: boolean;
  existingListingsCount: number;
  potentialDuplicateOfIds: string[];
  mediaRightsWarning: boolean;
  restrictedCategoryWarning: boolean;
  sourceUrl: string | null;
};

export type SupplierCatalogWorld = {
  key: string;
  label: string;
  description: string;
  connections: SupplierConnectionFixture[];
  fetchFailures: SupplierFetchFailure[];
  products: SupplierProductFixture[];
};

/**
 * A live-resolved rate for one supplier currency, keyed by ISO code (`USD`,
 * `AUD`). Resolved once per request at the page boundary
 * (`resolveCatalogFxRates()`) and passed down, so `estimatePhpMinor` below
 * stays a pure, synchronous function - the same shape `feed.ts` already uses
 * for the real storefront pricing config.
 */
export type CatalogFxRates = Record<
  string,
  { effectiveRate: number; fetchedAt: string; stale: boolean } | undefined
>;

export type ListingState = 'NOT_LISTED' | 'HAS_LISTING' | 'MULTIPLE_LISTINGS';

export function listingStateOf(existingListingsCount: number): ListingState {
  if (existingListingsCount === 0) return 'NOT_LISTED';

  return existingListingsCount === 1 ? 'HAS_LISTING' : 'MULTIPLE_LISTINGS';
}
