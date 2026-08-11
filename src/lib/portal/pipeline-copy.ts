import type { PipelineTab } from './pipeline-tabs';

/**
 * Seller-facing copy for the Product Sourcing tabs, kept out of the page so
 * `page.tsx` stays composition and data orchestration only. Every string
 * describes what the automated pipeline did, never an action the seller is
 * expected to take on a tab that has none.
 */
export const TAB_DESCRIPTIONS: Record<PipelineTab, string> = {
  all: 'Every candidate the automated pipeline has touched, one status per row.',
  ready:
    'Passed automated evaluation with no open issue - safe to customize and list as-is.',
  'needs-attention':
    'Passed, but with a warning flagged - still eligible to customize and list.',
  evaluating:
    'Queued or being checked for pricing, stock, and policy. Moves on its own - nothing to do here.',
  blocked:
    'Could not qualify - permanently (policy/pricing) or temporarily (e.g. supplier out of stock).',
  exception:
    'The pipeline itself failed here after every retry. Needs a person, not a product judgment call.',
};

/** Shown when the tab itself holds no rows - never when a search merely matched none of them. */
export const EMPTY_STATE_COPY: Record<
  PipelineTab,
  { title: string; description: string }
> = {
  all: {
    title: 'Nothing has been evaluated yet',
    description:
      'The automated evaluation pipeline populates this screen on its own as CJ products are discovered.',
  },
  ready: {
    title: 'No candidates are ready yet',
    description:
      'The automated evaluation pipeline populates this screen on its own as CJ products pass every check.',
  },
  'needs-attention': {
    title: 'No candidates need attention',
    description:
      'Candidates with a warning - but still eligible to customize and list - appear here automatically.',
  },
  evaluating: {
    title: 'Nothing is queued right now',
    description:
      'New and changed CJ products are picked up automatically by the ingestion job.',
  },
  blocked: {
    title: 'Nothing is blocked right now',
    description:
      'Candidates the automated pipeline could not qualify - permanently or for now - appear here.',
  },
  exception: {
    title: 'No operational exceptions',
    description:
      'Ordinary rejected or temporarily unavailable candidates never appear here - only evaluations that failed every automatic retry.',
  },
};
