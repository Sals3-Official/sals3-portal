import type { Metadata } from 'next';
import { z } from 'zod';
import PageHeader from '@/components/portal/PageHeader';
import AllCandidatesTable from '@/components/products/cj/AllCandidatesTable';
import BlockedCandidatesTable from '@/components/products/cj/BlockedCandidatesTable';
import EvaluatingCandidatesTable from '@/components/products/cj/EvaluatingCandidatesTable';
import ExceptionQueueTable from '@/components/products/cj/ExceptionQueueTable';
import PipelinePagination from '@/components/products/cj/PipelinePagination';
import PipelineSearchInput from '@/components/products/cj/PipelineSearchInput';
import PipelineTabs from '@/components/products/cj/PipelineTabs';
import QualifiedCandidatesTable from '@/components/products/cj/QualifiedCandidatesTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import { readOrUnavailable } from '@/lib/db/availability';
import { parsePageParam } from '@/lib/portal/pagination';
import { EMPTY_STATE_COPY, TAB_DESCRIPTIONS } from '@/lib/portal/pipeline-copy';
import {
  countForTab,
  parsePipelineTab,
  PIPELINE_TAB_LABELS,
  type PipelineTab,
} from '@/lib/portal/pipeline-tabs';
import resolvePipelinePageData, {
  type PipelinePageData,
} from '@/modules/catalog/candidates/pipeline-page-data';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import { findCataloguedCandidateIds } from '@/modules/catalog/products/read-model';

export const metadata: Metadata = { title: 'Product Sourcing · Sals3 Portal' };
export const dynamic = 'force-dynamic';

/** ~6 ticks at the default 5-minute GitHub Actions schedule (evaluate-tick.yml). */
const STALE_QUEUE_THRESHOLD_MS = 30 * 60 * 1000;

const querySchema = z.object({
  tab: z.string().optional(),
  q: z.string().max(120).optional(),
  page: z.string().max(12).optional(),
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function renderTable(
  tab: PipelineTab,
  candidates: EvaluatedCandidateRow[],
  tabIsEmpty: boolean,
  search: string,
  cataloguedCandidateIds: string[],
) {
  if (candidates.length === 0) {
    if (tabIsEmpty) {
      const copy = EMPTY_STATE_COPY[tab];

      return (
        <SourcingEmptyState title={copy.title} description={copy.description} />
      );
    }

    return (
      <SourcingEmptyState
        title="No matches"
        description={`No candidate in ${PIPELINE_TAB_LABELS[tab]} matches "${search}".`}
      />
    );
  }

  switch (tab) {
    case 'ready':
      return (
        <QualifiedCandidatesTable
          candidates={candidates}
          showReasons={false}
          cataloguedCandidateIds={cataloguedCandidateIds}
        />
      );
    case 'needs-attention':
      return (
        <QualifiedCandidatesTable
          candidates={candidates}
          showReasons
          cataloguedCandidateIds={cataloguedCandidateIds}
        />
      );
    case 'evaluating':
      return <EvaluatingCandidatesTable candidates={candidates} />;
    case 'blocked':
      return <BlockedCandidatesTable candidates={candidates} />;
    case 'exception':
      return <ExceptionQueueTable candidates={candidates} />;
    case 'all':
    default:
      return <AllCandidatesTable candidates={candidates} />;
  }
}

function renderEvaluatingBreakdown(
  tab: PipelineTab,
  counts: PipelinePageData['counts'],
) {
  if (tab !== 'evaluating' || counts === null) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <StatusPill
        label={`Queued ${counts.evaluatingQueued.toLocaleString()}`}
        tone="neutral"
        className="w-fit"
      />
      <StatusPill
        label={`Processing now ${counts.evaluatingProcessing.toLocaleString()}`}
        tone="info"
        className="w-fit"
      />
    </div>
  );
}

/**
 * Counts the rows the tab holds in total, not the ones on this page: the
 * header used to report the fetched-row count, so a tab holding 86,605
 * candidates announced "100 candidates" - the page size - as if that were
 * everything there was.
 */
function headerDescription(
  window: PipelinePageData['window'],
  search: string,
): string {
  const noun = window.total === 1 ? 'candidate' : 'candidates';
  const scope = search === '' ? '' : ` matching "${search}"`;

  return `${window.total.toLocaleString()} ${noun}${scope}`;
}

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
  const query = querySchema.parse(await searchParams);
  const tab = parsePipelineTab(query.tab);
  const search = query.q?.trim() ?? '';

  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Product Sourcing"
          description={PIPELINE_TAB_LABELS[tab]}
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so evaluated candidates cannot be read. This page works against a configured Postgres database - see the README."
        />
      </div>
    );
  }

  // `resolvePipelinePageData` already tolerates a read failure, but resolving
  // the seller account happens before it and is itself a query - so an
  // unreachable database still crashed this page ahead of that guard.
  const resolved = await readOrUnavailable('candidate pipeline', async () => {
    const { sellerAccount } = await requireDropshipperAccount();
    const data = await resolvePipelinePageData(sellerAccount.id, tab, {
      search,
      requestedPage: parsePageParam(query.page),
    });
    const cataloguedCandidateIds =
      tab === 'ready' || tab === 'needs-attention'
        ? [
            ...(await findCataloguedCandidateIds(
              sellerAccount.id,
              data.candidates.map((candidate) => candidate.candidateId),
            )),
          ]
        : [];

    return { ...data, cataloguedCandidateIds };
  });

  if (!resolved.ok) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Product Sourcing"
          description={PIPELINE_TAB_LABELS[tab]}
        />
        <SourcingEmptyState
          title="Cannot reach the database right now"
          description="Evaluated candidates could not be loaded because the database did not respond. No candidate, decision, or evidence has been changed. Check that Postgres is running and that DATABASE_URL points at an existing database, then reload."
        />
      </div>
    );
  }

  const { counts, candidates, queueAgeMs, window, cataloguedCandidateIds } =
    resolved.data;
  const isStale =
    tab === 'exception' &&
    queueAgeMs !== null &&
    queueAgeMs > STALE_QUEUE_THRESHOLD_MS;
  const tabParams = {
    tab,
    ...(search === '' ? {} : { q: search }),
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product Sourcing"
        description={headerDescription(window, search)}
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
      {renderEvaluatingBreakdown(tab, counts)}
      {renderTable(
        tab,
        candidates,
        countForTab(tab, counts) === 0,
        search,
        cataloguedCandidateIds,
      )}
      {window.totalPages > 1 ? (
        <PipelinePagination
          page={window.page}
          totalPages={window.totalPages}
          total={window.total}
          currentParams={tabParams}
        />
      ) : null}
    </div>
  );
}
