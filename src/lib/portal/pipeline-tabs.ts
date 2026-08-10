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

export const PIPELINE_TAB_LABELS: Record<PipelineTab, string> = {
  all: 'All',
  ready: 'Ready',
  'needs-attention': 'Needs Attention',
  evaluating: 'Evaluating',
  blocked: 'Blocked / Rejected',
  exception: 'Exception Queue',
};
