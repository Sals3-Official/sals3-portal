import type { CandidateStatusCounts } from '@/modules/catalog/candidates/queries';

/**
 * One shared vocabulary for the Product Sourcing pipeline's tab bar, its
 * page, and the nav rail links that jump into it - a typo here would
 * silently 404 a sidebar link instead of failing a type check.
 */
export const PIPELINE_TABS = [
  'all',
  'ready',
  'needs-attention',
  'evaluating',
  'blocked',
  'exception',
] as const;

export type PipelineTab = (typeof PIPELINE_TABS)[number];

/**
 * The one sidebar entry (`/products/pipeline`, no query) lands here - "see
 * everything from one link" only holds if the bare route actually shows
 * everything. Every retired per-status route still redirects with an
 * explicit `?tab=`, so a bookmark for "Ready" keeps landing on Ready.
 */
export const DEFAULT_PIPELINE_TAB: PipelineTab = 'all';

export function parsePipelineTab(value: string | undefined): PipelineTab {
  return (PIPELINE_TABS as readonly string[]).includes(value ?? '')
    ? (value as PipelineTab)
    : DEFAULT_PIPELINE_TAB;
}

/**
 * One tab's unfiltered total, from the shared count summary. Lives here, not
 * in the tab bar, because the page needs the same number to tell an empty
 * tab ("nothing is blocked right now") apart from a search that matched
 * nothing inside a tab that does hold rows - two different empty states that
 * a single fetched-row count cannot distinguish once the search runs in SQL.
 *
 * Never search-filtered: the tab badges report what the pipeline holds, so
 * typing in the search box narrows the table without rewriting every badge.
 */
export function countForTab(
  tab: PipelineTab,
  counts: CandidateStatusCounts | null,
): number {
  if (counts === null) return 0;

  switch (tab) {
    case 'all':
      return (
        counts.ready +
        counts.needsAttention +
        counts.evaluating +
        counts.blockedRejected +
        counts.exceptionQueue
      );
    case 'ready':
      return counts.ready;
    case 'needs-attention':
      return counts.needsAttention;
    case 'evaluating':
      return counts.evaluating;
    case 'blocked':
      return counts.blockedRejected;
    case 'exception':
      return counts.exceptionQueue;
    default: {
      const exhaustive: never = tab;
      throw new Error(`Uncounted pipeline tab: ${exhaustive}`);
    }
  }
}

export const PIPELINE_TAB_LABELS: Record<PipelineTab, string> = {
  all: 'All',
  ready: 'Ready',
  'needs-attention': 'Needs Attention',
  evaluating: 'Queued / Evaluating',
  blocked: 'Blocked / Rejected',
  exception: 'Exception Queue',
};
