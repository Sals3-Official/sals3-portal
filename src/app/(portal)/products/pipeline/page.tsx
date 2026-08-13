import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import CandidateDetailDrawer from '@/components/products/cj/CandidateDetailDrawer';
import EvaluatingBreakdown from '@/components/products/cj/EvaluatingBreakdown';
import PipelinePagination from '@/components/products/cj/PipelinePagination';
import PipelineSearchInput from '@/components/products/cj/PipelineSearchInput';
import PipelineTabs from '@/components/products/cj/PipelineTabs';
import PipelineTabTable from '@/components/products/cj/PipelineTabTable';
import PipelineUnavailable from '@/components/products/cj/PipelineUnavailable';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import { readOrUnavailable } from '@/lib/db/availability';
import { parsePageParam } from '@/lib/portal/pagination';
import {
  pipelineHeaderDescription,
  TAB_DESCRIPTIONS,
} from '@/lib/portal/pipeline-copy';
import {
  pipelineCurrentParams,
  pipelinePageQuerySchema,
} from '@/lib/portal/pipeline-params';
import { countForTab, parsePipelineTab } from '@/lib/portal/pipeline-tabs';
import resolvePipelinePageData from '@/modules/catalog/candidates/pipeline-page-data';

export const metadata: Metadata = { title: 'Product Sourcing · Sals3 Portal' };
export const dynamic = 'force-dynamic';

/** ~6 ticks at the default 5-minute GitHub Actions schedule (evaluate-tick.yml). */
const STALE_QUEUE_THRESHOLD_MS = 30 * 60 * 1000;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Product Sourcing, one window. Was five separate routes (Qualified
 * Products -> Ready/Needs Attention, Evaluating, Blocked/Rejected, Exception
 * Queue) - each still exists as a redirect into this page's `?tab=` so an old
 * bookmark or sidebar link keeps working. Each tab is a real link (not
 * client-only tab state) because it queries a different decision status
 * server-side, is paged server-side through `?page=`, and searches its whole
 * tab in SQL rather than filtering the page already in hand.
 */
export default async function ProductSourcingPipelinePage({
  searchParams,
}: PageProps) {
  const query = pipelinePageQuerySchema.parse(await searchParams);
  const tab = parsePipelineTab(query.tab);
  const search = query.q?.trim() ?? '';

  if (!isDatabaseConfigured()) {
    return <PipelineUnavailable reason="not-configured" tab={tab} />;
  }

  // `resolvePipelinePageData` already tolerates a read failure, but resolving
  // the seller account happens before it and is itself a query - so an
  // unreachable database still crashed this page ahead of that guard.
  // The seller account id is returned alongside the page data because the
  // detail drawer needs it to scope its own read - resolving it a second time
  // would be a second auth query per row click.
  const resolved = await readOrUnavailable('candidate pipeline', async () => {
    const { sellerAccount } = await requireDropshipperAccount();

    return {
      sellerAccountId: sellerAccount.id,
      pageData: await resolvePipelinePageData(sellerAccount.id, tab, {
        search,
        requestedPage: parsePageParam(query.page),
      }),
    };
  });

  if (!resolved.ok) {
    return <PipelineUnavailable reason="unreachable" tab={tab} />;
  }

  const { sellerAccountId, pageData } = resolved.data;
  const { counts, candidates, queueAgeMs, window } = pageData;
  const isStale =
    tab === 'exception' &&
    queueAgeMs !== null &&
    queueAgeMs > STALE_QUEUE_THRESHOLD_MS;
  const tabParams = {
    tab,
    ...(search === '' ? {} : { q: search }),
  };
  // Carries `page` too, so opening the drawer does not reset the list. Paging
  // and switching tabs keep using `tabParams`, which has no `candidate` - so
  // both correctly close the drawer.
  const currentParams = pipelineCurrentParams({ ...query, tab });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product Sourcing"
        description={pipelineHeaderDescription(window, search)}
      />
      <SourcingInfoBanner>{TAB_DESCRIPTIONS[tab]}</SourcingInfoBanner>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PipelineTabs
          active={tab}
          counts={counts}
          searchParams={search === '' ? {} : { q: search }}
        />
        <PipelineSearchInput value={search} />
      </div>
      {isStale ? (
        <StatusPill
          label={`Oldest queued candidate has waited ${Math.round((queueAgeMs ?? 0) / 60_000)} minutes - the evaluation processor may be stopped or stale`}
          tone="danger"
          className="w-fit whitespace-normal"
        />
      ) : null}
      {tab === 'exception' && candidates.length > 0 ? (
        <StatusPill
          label="These need a person - CJ evidence could not be fetched after every automatic retry"
          tone="danger"
          className="w-fit whitespace-normal"
        />
      ) : null}
      {tab === 'evaluating' ? <EvaluatingBreakdown counts={counts} /> : null}
      <PipelineTabTable
        tab={tab}
        candidates={candidates}
        tabIsEmpty={countForTab(tab, counts) === 0}
        search={search}
        currentParams={currentParams}
      />
      {window.totalPages > 1 ? (
        <PipelinePagination
          page={window.page}
          totalPages={window.totalPages}
          total={window.total}
          currentParams={tabParams}
        />
      ) : null}
      {query.candidate === '' ? null : (
        <CandidateDetailDrawer
          sellerAccountId={sellerAccountId}
          candidateId={query.candidate}
          currentParams={currentParams}
        />
      )}
    </div>
  );
}
