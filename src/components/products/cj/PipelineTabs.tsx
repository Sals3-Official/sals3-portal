import Link from 'next/link';
import { cn } from '@/lib/utils';
import { buildHref } from '@/lib/portal/search-params';
import type { CandidateStatusCounts } from '@/modules/catalog/candidates/queries';
import {
  countForTab,
  PIPELINE_TABS,
  PIPELINE_TAB_LABELS,
  type PipelineTab,
} from '@/lib/portal/pipeline-tabs';

type PipelineTabsProps = {
  active: PipelineTab;
  /** Null when no real count was resolvable this request - render every count as 0 rather than guess. */
  counts: CandidateStatusCounts | null;
  searchParams: Record<string, string>;
};

/**
 * Server-rendered tab bar: every tab is a real link (`?tab=`), not client
 * state, because each one triggers a different server query. Switching tabs
 * keeps `q` (the search box) so a search survives a tab change.
 */
export default function PipelineTabs({
  active,
  counts,
  searchParams,
}: PipelineTabsProps) {
  return (
    <div
      role="tablist"
      className="inline-flex w-fit flex-wrap items-center gap-1 rounded-lg bg-muted p-[3px]"
    >
      {PIPELINE_TABS.map((tab) => {
        const isActive = tab === active;

        return (
          <Link
            key={tab}
            href={buildHref('/products/pipeline', searchParams, { tab })}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-all',
              isActive
                ? 'bg-background text-foreground shadow-sm dark:bg-input/30'
                : 'text-foreground/60 hover:text-foreground',
            )}
          >
            {PIPELINE_TAB_LABELS[tab]}
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                isActive
                  ? 'bg-muted text-ink-muted'
                  : 'bg-background/60 text-muted-foreground',
              )}
            >
              {countForTab(tab, counts).toLocaleString()}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
