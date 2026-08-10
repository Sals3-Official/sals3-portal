import type { Metadata } from 'next';
import { z } from 'zod';
import PageHeader from '@/components/portal/PageHeader';
import AllCandidatesTable from '@/components/products/cj/AllCandidatesTable';
import BlockedCandidatesTable from '@/components/products/cj/BlockedCandidatesTable';
import EvaluatingCandidatesTable from '@/components/products/cj/EvaluatingCandidatesTable';
import ExceptionQueueTable from '@/components/products/cj/ExceptionQueueTable';
import PipelineSearchInput from '@/components/products/cj/PipelineSearchInput';
import PipelineTabs from '@/components/products/cj/PipelineTabs';
import QualifiedCandidatesTable from '@/components/products/cj/QualifiedCandidatesTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { displayName } from '@/components/products/cj/candidate-view';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  parsePipelineTab,
  PIPELINE_TAB_LABELS,
  type PipelineTab,
} from '@/lib/portal/pipeline-tabs';
import {
  countCandidateStatusSummary,
  listCandidatesByStatus,
  listDeadLetteredEvaluations,
  oldestQueuedAgeMs,
  type EvaluatedCandidateRow,
} from '@/modules/catalog/candidates/queries';

export const metadata: Metadata = { title: 'Product Sourcing · Sals3 Portal' };
export const dynamic = 'force-dynamic';

/** ~6 ticks at the default 5-minute GitHub Actions schedule (evaluate-tick.yml). */
const STALE_QUEUE_THRESHOLD_MS = 30 * 60 * 1000;

const TAB_DESCRIPTIONS: Record<PipelineTab, string> = {
  all: 'Every candidate the automated pipeline has touched, one status per row.',
  ready:
    'Passed automated evaluation with no open issue - safe to customize and list as-is.',
  'needs-attention':
    'Passed, but with a warning flagged - still eligible to customize and list.',
  evaluating:
    'Being checked right now (pricing, stock, policy). Moves on its own - nothing to do here.',
  blocked:
    'Could not qualify - permanently (policy/pricing) or temporarily (e.g. supplier out of stock).',
  exception:
    'The pipeline itself failed here after every retry. Needs a person, not a product judgment call.',
};

const EMPTY_STATE_COPY: Record<
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

const querySchema = z.object({
  tab: z.string().optional(),
  q: z.string().max(120).optional(),
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function matchesSearch(candidate: EvaluatedCandidateRow, term: string) {
  const needle = term.toLowerCase();
  const name = displayName(
    candidate.externalProductId,
    candidate.evidence,
  ).toLowerCase();

  return (
    name.includes(needle) ||
    candidate.externalProductId.toLowerCase().includes(needle) ||
    (candidate.evidence?.supplierSku.toLowerCase().includes(needle) ?? false)
  );
}

async function fetchTabCandidates(
  sellerAccountId: string,
  tab: PipelineTab,
): Promise<EvaluatedCandidateRow[]> {
  switch (tab) {
    case 'ready':
      return listCandidatesByStatus(sellerAccountId, ['PASS']);
    case 'needs-attention':
      return listCandidatesByStatus(sellerAccountId, ['PASS_WITH_ATTENTION']);
    case 'evaluating':
      return listCandidatesByStatus(sellerAccountId, ['QUEUED', 'EVALUATING']);
    case 'blocked':
      return listCandidatesByStatus(sellerAccountId, [
        'BLOCKED',
        'TEMPORARILY_INELIGIBLE',
      ]);
    case 'exception':
      return listDeadLetteredEvaluations(sellerAccountId);
    case 'all': {
      const [decided, exhausted] = await Promise.all([
        listCandidatesByStatus(sellerAccountId, [
          'PASS',
          'PASS_WITH_ATTENTION',
          'QUEUED',
          'EVALUATING',
          'BLOCKED',
          'TEMPORARILY_INELIGIBLE',
        ]),
        listDeadLetteredEvaluations(sellerAccountId),
      ]);

      return [...decided, ...exhausted].sort(
        (a, b) =>
          new Date(b.evaluation.updatedAt).getTime() -
          new Date(a.evaluation.updatedAt).getTime(),
      );
    }
    default:
      return [];
  }
}

function renderTable(
  tab: PipelineTab,
  filtered: EvaluatedCandidateRow[],
  tabIsEmpty: boolean,
  search: string,
) {
  if (filtered.length === 0) {
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
        <QualifiedCandidatesTable candidates={filtered} showReasons={false} />
      );
    case 'needs-attention':
      return <QualifiedCandidatesTable candidates={filtered} showReasons />;
    case 'evaluating':
      return <EvaluatingCandidatesTable candidates={filtered} />;
    case 'blocked':
      return <BlockedCandidatesTable candidates={filtered} />;
    case 'exception':
      return <ExceptionQueueTable candidates={filtered} />;
    case 'all':
    default:
      return <AllCandidatesTable candidates={filtered} />;
  }
}

/**
 * Product Sourcing, one window. Was five separate routes (Qualified
 * Products -> Ready/Needs Attention, Evaluating, Blocked/Rejected, Exception
 * Queue) - each still exists as a redirect into this page's `?tab=` so an old
 * bookmark or sidebar link keeps working. Each tab is a real link (not
 * client-only tab state) because it queries a different decision status
 * server-side; the search box filters whatever that tab already fetched, no
 * extra round trip.
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

  const { sellerAccount } = await requireDropshipperAccount();
  const [counts, candidates, queueAgeMs] = await Promise.all([
    countCandidateStatusSummary(sellerAccount.id),
    fetchTabCandidates(sellerAccount.id, tab),
    tab === 'exception' ? oldestQueuedAgeMs(sellerAccount.id) : null,
  ]);
  const filtered =
    search === ''
      ? candidates
      : candidates.filter((candidate) => matchesSearch(candidate, search));
  const isStale =
    tab === 'exception' &&
    queueAgeMs !== null &&
    queueAgeMs > STALE_QUEUE_THRESHOLD_MS;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product Sourcing"
        description={`${filtered.length} ${filtered.length === 1 ? 'candidate' : 'candidates'}${search === '' ? '' : ` matching "${search}"`}`}
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
      {renderTable(tab, filtered, candidates.length === 0, search)}
    </div>
  );
}
