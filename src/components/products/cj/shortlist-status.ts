import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type { CheckForSals3Result } from '@/app/(portal)/products/actions';

export type ShortlistStatusPresentation = {
  label: string;
  tone: StatusPillTone;
  description: string;
};

/**
 * Single source of truth for how a shortlist outcome reads to a human, shared
 * by the row action and the drawer so the two cannot drift apart.
 *
 * No branch here ever produces "Ready", "Ready · Needs Attention", "Review
 * Required", "On Hold", or "Blocked": those are preflight decisions (spec
 * section 8.4) and nothing in this app can produce one yet.
 */
const FAILURE_TEXT: Record<
  Extract<CheckForSals3Result, { ok: false }>['reason'],
  ShortlistStatusPresentation
> = {
  invalid_input: {
    label: 'Not shortlisted',
    tone: 'warning',
    description: 'This supplier product id was not in an expected format.',
  },
  denied: {
    label: 'Not shortlisted',
    tone: 'warning',
    description: 'Your role cannot shortlist candidates.',
  },
  rate_limited: {
    label: 'Not shortlisted',
    tone: 'warning',
    description: 'Too many shortlist requests. Wait a moment and try again.',
  },
  conflict: {
    label: 'Not shortlisted',
    tone: 'warning',
    description: 'That request conflicted with an earlier one. Try again.',
  },
  failed: {
    label: 'Not shortlisted',
    tone: 'danger',
    description: 'Saving the candidate failed. Try again in a moment.',
  },
};

export default function presentShortlistResult(
  result: CheckForSals3Result | null,
): ShortlistStatusPresentation {
  if (result === null) {
    return {
      label: 'Check for Sals3',
      tone: 'neutral',
      description: 'Not checked yet.',
    };
  }

  if (!result.ok) {
    return FAILURE_TEXT[result.reason];
  }

  return {
    label: 'Shortlisted',
    tone: 'info',
    description: result.reused
      ? 'Already shortlisted earlier. Full preflight has not run yet.'
      : 'Saved as a Sals3 candidate. Full preflight has not run yet.',
  };
}
