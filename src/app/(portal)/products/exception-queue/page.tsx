import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import ExceptionQueueTable from '@/components/products/cj/ExceptionQueueTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  listDeadLetteredEvaluations,
  oldestQueuedAgeMs,
} from '@/modules/catalog/candidates/queries';

export const metadata: Metadata = { title: 'Exception Queue · Sals3 Portal' };
export const dynamic = 'force-dynamic';

/** ~6 ticks at the default 5-minute GitHub Actions schedule (evaluate-tick.yml). */
const STALE_QUEUE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Exception Queue: genuine operational failures only (evaluation retries
 * exhausted after `MAX_EVALUATION_ATTEMPTS`), never ordinary rejected
 * products - those live on Blocked/Rejected instead (spec's explicit "do
 * not fill it with every low-quality CJ product").
 */
export default async function ExceptionQueuePage() {
  const { sellerAccount } = await requireDropshipperAccount();

  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Exception Queue"
          description="Operational failures needing a person"
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so exceptions cannot be read. This page works against a configured Postgres database - see the README."
        />
      </div>
    );
  }

  const [candidates, queueAgeMs] = await Promise.all([
    listDeadLetteredEvaluations(sellerAccount.id),
    oldestQueuedAgeMs(sellerAccount.id),
  ]);
  const isStale = queueAgeMs !== null && queueAgeMs > STALE_QUEUE_THRESHOLD_MS;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Exception Queue"
        description={`${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'} exhausted automatic retries`}
      />
      <SourcingInfoBanner>
        Products where the pipeline itself failed - e.g. it could not reach the
        supplier - after every automatic retry. This needs a person to look at
        the failure; ordinary rejected products live on Blocked / Rejected
        instead.
      </SourcingInfoBanner>
      {isStale ? (
        <StatusPill
          label={`Oldest queued candidate has waited ${Math.round((queueAgeMs ?? 0) / 60_000)} minutes - the evaluation processor may be stopped or stale`}
          tone="danger"
          className="w-fit whitespace-normal"
        />
      ) : null}
      {candidates.length === 0 ? (
        <SourcingEmptyState
          title="No operational exceptions"
          description="Ordinary rejected or temporarily unavailable candidates never appear here - only evaluations that failed every automatic retry."
        />
      ) : (
        <>
          <StatusPill
            label="These need a person - CJ evidence could not be fetched after every automatic retry"
            tone="danger"
            className="w-fit whitespace-normal"
          />
          <ExceptionQueueTable candidates={candidates} />
        </>
      )}
    </div>
  );
}
