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
 * The system performs the evaluation, not the seller (spec's UI
 * corrections): there is no click-to-check action anywhere this is used.
 */
const STATUS_TEXT: Record<EvaluationStatus, EvaluationStatusPresentation> = {
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
      'The pipeline is fetching fresh CJ evidence for this candidate now.',
  },
  PASS: {
    label: 'Ready',
    tone: 'success',
    description: 'Passed automated evaluation with no open issues.',
  },
  PASS_WITH_ATTENTION: {
    label: 'Needs attention',
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
      'CJ evidence could not be fetched. The pipeline will retry automatically.',
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
    'CJ evidence could not be fetched after every automatic retry. This needs manual review, not another automatic attempt.',
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
