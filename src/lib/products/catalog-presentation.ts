import {
  REASON_CODE_EXPLANATIONS,
  type ReasonCode,
} from '@/modules/catalog/candidates/rules/contracts';
import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type {
  CatalogFxRates,
  EvaluationStatus,
  SupplierConnectionStatus,
  StockAvailability,
} from './catalog-types';

/**
 * Presentation-only helpers for the redesign preview - money/date formatting
 * and status-to-copy mappings. Evaluation-status labels intentionally match
 * `src/components/products/cj/evaluation-status.ts` word for word: this is
 * the same pipeline wearing a new layout, not a new vocabulary.
 */

export type EvaluationPresentation = {
  label: string;
  tone: StatusPillTone;
  description: string;
};

const EVALUATION_TEXT: Record<EvaluationStatus, EvaluationPresentation> = {
  QUEUED: {
    label: 'Queued',
    tone: 'neutral',
    description:
      'Waiting for the automated evaluation pipeline to pick this up.',
  },
  EVALUATING: {
    label: 'Evaluating',
    tone: 'info',
    description:
      'The pipeline is fetching fresh supplier evidence for this candidate now.',
  },
  PASS: {
    label: 'Ready',
    tone: 'success',
    description: 'Passed automated evaluation with no open issue.',
  },
  PASS_WITH_ATTENTION: {
    label: 'Ready · Needs attention',
    tone: 'warning',
    description:
      'Passed with one or more warnings - still eligible to customize and list.',
  },
  TEMPORARILY_INELIGIBLE: {
    label: 'Temporarily unavailable',
    tone: 'warning',
    description:
      'A retryable issue (stock, shipping, or price) is blocking this candidate for now.',
  },
  BLOCKED: {
    label: 'Blocked',
    tone: 'danger',
    description: 'A permanent policy issue blocks this candidate. No override.',
  },
  EVALUATION_FAILED: {
    label: 'Evaluation failed',
    tone: 'danger',
    description:
      'Supplier evidence could not be fetched. The pipeline retries automatically - this is a technical gap, not a product-quality finding.',
  },
};

const NOT_YET_QUEUED: EvaluationPresentation = {
  label: 'Not yet queued',
  tone: 'neutral',
  description:
    'This product has been discovered but the automated pipeline has not processed it yet.',
};

export function presentEvaluationStatus(
  status: EvaluationStatus | null,
): EvaluationPresentation {
  return status === null ? NOT_YET_QUEUED : EVALUATION_TEXT[status];
}

/**
 * Two reason codes proposed for this redesign that do not exist in the real
 * pipeline's `REASON_CODES` yet - margin estimation and media-rights checks
 * are both explicitly "not implemented" per the README. Kept separate from
 * `REASON_CODE_EXPLANATIONS` so nothing here reads as already-shipped
 * pipeline behaviour.
 */
const PROPOSED_REASON_CODE_EXPLANATIONS: Record<string, string> = {
  LOW_MARGIN_ESTIMATE:
    'Estimated margin at the current supplier price is below the policy floor. (Proposed check - no real per-product margin rule exists yet.)',
  MEDIA_RIGHTS_UNCONFIRMED:
    "This supplier's media rights have not been confirmed as safe to reuse. (Proposed check - rights review is not implemented yet.)",
};

export function explainReasonCode(code: string): string {
  if (code in REASON_CODE_EXPLANATIONS) {
    return REASON_CODE_EXPLANATIONS[code as ReasonCode];
  }

  return PROPOSED_REASON_CODE_EXPLANATIONS[code] ?? code;
}

export const CONNECTION_STATUS_TEXT: Record<
  SupplierConnectionStatus,
  { label: string; tone: StatusPillTone }
> = {
  CONNECTED: { label: 'Connected', tone: 'success' },
  DEGRADED: { label: 'Degraded', tone: 'warning' },
  REAUTH_REQUIRED: { label: 'Needs reconnection', tone: 'warning' },
  PENDING: { label: 'Pending', tone: 'neutral' },
  DISCONNECTED: { label: 'Disconnected', tone: 'danger' },
  REVOKED: { label: 'Revoked', tone: 'danger' },
};

export const STOCK_TEXT: Record<
  StockAvailability,
  { label: string; tone: StatusPillTone }
> = {
  IN_STOCK: { label: 'In stock', tone: 'success' },
  PARTIAL_VARIANT_STOCK: { label: 'Partial variant stock', tone: 'warning' },
  OUT_OF_STOCK: { label: 'Out of stock', tone: 'danger' },
  UNKNOWN: { label: 'Not available', tone: 'neutral' },
};

/** Connections a seller can actually pick as a catalog filter (spec section 4). */
export function isUsableAsFilter(status: SupplierConnectionStatus): boolean {
  return status === 'CONNECTED' || status === 'DEGRADED';
}

export function formatMinorUnits(minor: number, currency: string): string {
  const major = minor / 100;

  return `${major.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

/**
 * Converts a supplier price to an estimated PHP amount using a live-resolved
 * rate, or `null` when the row's currency has no resolved rate - a currency
 * this catalog does not (yet) know how to convert is shown as "no estimate",
 * never guessed at.
 */
export function estimatePhpMinor(
  currency: string,
  priceMinor: number,
  rates: CatalogFxRates,
): number | null {
  const rate = rates[currency];

  if (rate === undefined) return null;

  return Math.round(priceMinor * rate.effectiveRate);
}

export function formatPhpEstimate(minor: number | null): string | null {
  if (minor === null) return null;

  return `₱${(minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `nowIso` is passed in explicitly so this stays a pure function - no `Date.now()` at render time. */
export function formatRelativeTime(iso: string, nowIso: string): string {
  const diffMs = new Date(nowIso).getTime() - new Date(iso).getTime();

  if (diffMs < MINUTE_MS) return 'just now';
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;

  return `${Math.floor(diffMs / DAY_MS)}d ago`;
}
