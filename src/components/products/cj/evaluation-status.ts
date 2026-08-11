import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type { EvaluationStatus } from '@/modules/catalog/candidates/rules/contracts';
import { MAX_EVALUATION_ATTEMPTS } from '@/modules/catalog/candidates/rules/policy';

export type EvaluationStatusPresentation = {
  label: string;
  tone: StatusPillTone;
  description: string;
};

/**
 * Single source of truth for how an automated evaluation status reads to a
 * human - shared by every row badge and drawer so they cannot drift apart.
 * The system performs the screening, not the seller: there is no
 * click-to-check action anywhere this is used.
 *
 * Copy corrected 2026-08-12 for the lean intake policy (ADR-013 §1a). Raw
 * catalogue screening decides from the persisted supplier listing summary
 * and makes no CJ detail/inventory/comments call, so the old wording
 * ("fetching fresh CJ evidence", "CJ evidence could not be fetched") would
 * now describe work that does not happen. Just as importantly, a screening
 * pass is NOT a stock confirmation: stock lives on its own manual review
 * axis and every label below is careful not to imply otherwise.
 */
const STATUS_TEXT: Record<EvaluationStatus, EvaluationStatusPresentation> = {
  QUEUED: {
    label: 'Queued',
    tone: 'neutral',
    description:
      'Waiting for the automated screening pipeline to pick this up.',
  },
  EVALUATING: {
    label: 'Screening',
    tone: 'info',
    description:
      'Local Sals3 screening is running against the persisted supplier listing summary. No supplier call is made.',
  },
  PASS: {
    label: 'Screening passed',
    tone: 'success',
    description:
      'Nothing in the supplier listing summary disqualifies this product. Stock has not been checked, and this is not a freight or publication confirmation.',
  },
  PASS_WITH_ATTENTION: {
    label: 'Needs attention',
    tone: 'warning',
    description:
      'Screening passed with one or more warnings. Stock is still unconfirmed until someone records a manual check.',
  },
  TEMPORARILY_INELIGIBLE: {
    label: 'Temporarily unavailable',
    tone: 'warning',
    description:
      'A recoverable screening issue (market, price) blocks this candidate for now. It re-opens when the supplier data or the policy changes.',
  },
  BLOCKED: {
    label: 'Blocked',
    tone: 'danger',
    description: 'A permanent policy issue blocks this candidate. No override.',
  },
  EVALUATION_FAILED: {
    label: 'Screening failed',
    tone: 'danger',
    description:
      'Local screening could not complete for this candidate. The pipeline will retry automatically.',
  },
};

const NOT_TRACKED: EvaluationStatusPresentation = {
  label: 'Not yet queued',
  tone: 'neutral',
  description:
    'This product has not been picked up by the automated pipeline yet.',
};

const EXHAUSTED_EVALUATION_FAILED: EvaluationStatusPresentation = {
  label: 'Needs a person',
  tone: 'danger',
  description:
    'Local screening could not complete after every automatic retry. This needs manual review, not another automatic attempt.',
};

/**
 * `attemptCount` is optional so every existing call site keeps compiling,
 * but pass it whenever available: `EVALUATION_FAILED` reads very
 * differently before the automatic-retry cap ("will retry automatically",
 * `STATUS_TEXT`'s entry) versus after it (`EXHAUSTED_EVALUATION_FAILED`) -
 * the status column alone cannot tell those two apart, same distinction
 * `pipeline-bucket.ts#classifyPipelineBucket` makes for the list tables.
 */
export default function presentEvaluationStatus(
  status: EvaluationStatus | null,
  attemptCount: number | null = null,
): EvaluationStatusPresentation {
  if (status === null) return NOT_TRACKED;

  if (
    status === 'EVALUATION_FAILED' &&
    attemptCount !== null &&
    attemptCount >= MAX_EVALUATION_ATTEMPTS
  ) {
    return EXHAUSTED_EVALUATION_FAILED;
  }

  return STATUS_TEXT[status];
}
