import { MAX_EVALUATION_ATTEMPTS } from './rules/policy';
import type { EvaluationStatus } from './rules/contracts';

/**
 * The five seller-visible tabs on `/products/pipeline`. Every nonterminal or
 * decided candidate must land in exactly one - never zero, never more than
 * one.
 */
export const PIPELINE_BUCKETS = [
  'ready',
  'needsAttention',
  'evaluating',
  'blockedRejected',
  'exceptionQueue',
] as const;

export type PipelineBucket = (typeof PIPELINE_BUCKETS)[number];

/**
 * Single source of truth for which bucket one `candidate_evaluations` row
 * belongs to. `queries.ts`'s list/count functions must each return a result
 * consistent with this function - it is the pure, unit-testable spec they
 * are hand-transcribed from (Drizzle query conditions cannot be evaluated
 * outside a real database, so this function is what gets tested directly
 * for exhaustive, non-overlapping coverage).
 *
 * `EVALUATION_FAILED` is the one status that does not map to a single
 * bucket by itself: below the automatic-retry cap it is still mid-pipeline
 * (`evaluating`, same as `QUEUED`/`EVALUATING`); at or past the cap it is
 * dead-lettered (`exceptionQueue`). Splitting on `status` alone - the
 * previous behavior - let a mid-retry failure disappear from every tab,
 * because no tab's query included it and the Exception Queue's own
 * `attemptCount` filter excluded it too.
 */
export function classifyPipelineBucket(
  status: EvaluationStatus,
  attemptCount: number,
): PipelineBucket {
  switch (status) {
    case 'PASS':
      return 'ready';
    case 'PASS_WITH_ATTENTION':
      return 'needsAttention';
    case 'QUEUED':
    case 'EVALUATING':
      return 'evaluating';
    case 'BLOCKED':
    case 'TEMPORARILY_INELIGIBLE':
      return 'blockedRejected';
    case 'EVALUATION_FAILED':
      return attemptCount >= MAX_EVALUATION_ATTEMPTS
        ? 'exceptionQueue'
        : 'evaluating';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unclassified evaluation status: ${exhaustive}`);
    }
  }
}
