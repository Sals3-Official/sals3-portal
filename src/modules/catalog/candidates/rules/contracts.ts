import { z } from 'zod';

/**
 * Shared vocabulary for the automated candidate-evaluation engine (spec
 * sections 8.4-8.6, 14). `reasonCodes` are validated here rather than as a
 * Postgres enum, matching the existing `intendedMarketCodes: text[]` pattern
 * in `contracts.ts` one level up.
 */

export const EVALUATION_STATUSES = [
  'QUEUED',
  'EVALUATING',
  'PASS',
  'PASS_WITH_ATTENTION',
  'TEMPORARILY_INELIGIBLE',
  'BLOCKED',
  'EVALUATION_FAILED',
] as const;

export const evaluationStatusSchema = z.enum(EVALUATION_STATUSES);
export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;

export const REASON_CODES = [
  'POLICY_BLOCKED',
  'COUNTRY_RESTRICTED',
  'COUNTERFEIT_HIGH_CONFIDENCE',
  'NO_VALID_MARKET',
  'NO_STOCK',
  /**
   * Legacy code, kept only so historical evaluation rows stay readable
   * (ADR-013). No code path writes this any more — see `NO_STOCKED_ORIGIN`.
   */
  'NO_SHIPPING_ROUTE',
  'NO_STOCKED_ORIGIN',
  'INVALID_SUPPLIER_DATA',
  'DATA_FETCH_FAILED',
  'DUPLICATE',
  'INVALID_PRICE',
  'INSUFFICIENT_PRODUCT_DATA',
  'ABNORMAL_PRICE_CHANGE',
] as const;

export const reasonCodeSchema = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

/** Human-readable explanation shown on the Blocked/Rejected page per reason code. */
export const REASON_CODE_EXPLANATIONS: Record<ReasonCode, string> = {
  POLICY_BLOCKED:
    'This category is on the conservative exclusion list until a pilot policy approves it.',
  COUNTRY_RESTRICTED:
    'This category is not cleared for the current placeholder market.',
  COUNTERFEIT_HIGH_CONFIDENCE:
    'The listing matches a protected brand name with no authorization evidence.',
  NO_VALID_MARKET: 'No enabled destination market applies to this candidate.',
  NO_STOCK: 'CJ reports zero stock across every variant and warehouse.',
  NO_SHIPPING_ROUTE:
    'CJ reports no warehouse with any stock, so no shipping origin exists.',
  NO_STOCKED_ORIGIN:
    'No observed supplier origin currently reports any stock. This does not mean a shipping route was checked or confirmed — only that no stocked origin was found.',
  INVALID_SUPPLIER_DATA:
    'The CJ response for this product could not be read safely.',
  DATA_FETCH_FAILED: 'CJ evidence could not be fetched for this candidate.',
  DUPLICATE: 'This CJ product is already shortlisted under another candidate.',
  INVALID_PRICE: 'The supplier price falls outside the configured valid range.',
  INSUFFICIENT_PRODUCT_DATA:
    'Required product data (images or variants) is missing or unusable.',
  ABNORMAL_PRICE_CHANGE:
    'The supplier price changed sharply since the last evaluation.',
};

/**
 * Which reason codes are a permanent policy/legal matter (no override, shown
 * on Blocked/Rejected as `BLOCKED`) versus a transient structural fact that
 * CJ could resolve on its own (shown on the same page as
 * `TEMPORARILY_INELIGIBLE`, auto-retried). This is a software/logical
 * classification, not a business number - unlike the thresholds in
 * `policy.ts`, it needs no owner approval.
 */
export const PERMANENT_REASON_CODES: readonly ReasonCode[] = [
  'POLICY_BLOCKED',
  'COUNTRY_RESTRICTED',
  'COUNTERFEIT_HIGH_CONFIDENCE',
  'DUPLICATE',
];

export type FindingSeverity = 'BLOCK' | 'ATTENTION' | 'INFO';

export type RuleFinding = {
  reasonCode: ReasonCode;
  severity: FindingSeverity;
  /** Extra detail beyond REASON_CODE_EXPLANATIONS, e.g. which category matched. */
  detail?: string;
};

/**
 * Denormalized CJ feed data captured at ingestion time, stored on
 * `candidate_evaluations.feed_snapshot`. Enough for the screening stage to
 * reject a candidate before spending CJ evidence-fetch points.
 */
export const feedSnapshotSchema = z.object({
  name: z.string(),
  category: z.string(),
  priceUsdCents: z.number().nullable(),
  listedCount: z.number().nullable(),
  shipsFrom: z.array(z.string()),
  /**
   * Display fields added 2026-08-12 for the lean All Supplier Products
   * catalogue, which now renders from persisted Sals3 data instead of a live
   * CJ `/product/list` call on every page view, search, and pagination.
   *
   * All are optional with a null/false default so rows written before this
   * change stay readable and render a neutral placeholder for the field they
   * never captured - no backfill and no supplier call is needed to read an
   * old row.
   */
  categoryId: z.string().nullish(),
  sku: z.string().nullish(),
  imageUrl: z.string().nullish(),
  weight: z.string().nullish(),
  productType: z.string().nullish(),
  supplierName: z.string().nullish(),
  freeShipping: z.boolean().nullish(),
  /** Provider creation date (ISO `yyyy-mm-dd`), as the feed reported it. */
  providerCreatedAt: z.string().nullish(),
});

export type FeedSnapshot = z.infer<typeof feedSnapshotSchema>;

export type EvidenceSummary = {
  usableImageCount: number;
  duplicateImageCount: number;
  variantCount: number;
  variantsWithStock: number;
  totalStockUnits: number | null;
  warehousesWithStock: number;
  sampledReviewCount: number;
  sampledAverageScore: number | null;
  /** Rough, non-product-differentiated proxy - see rules/policy.ts. Never a real margin. */
  estimatedMarginPercent: number;
  screeningNotes: string[];
};
