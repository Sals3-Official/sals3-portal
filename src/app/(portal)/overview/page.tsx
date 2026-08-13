import type { Metadata } from 'next';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { readOrUnavailable } from '@/lib/db/availability';
import PageHeader from '@/components/portal/PageHeader';
import LinkButton from '@/components/portal/LinkButton';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import OverviewMoneyPosition from '@/components/seller-center/overview/OverviewMoneyPosition';
import OverviewNeedsYouNow from '@/components/seller-center/overview/OverviewNeedsYouNow';
import OverviewRecentSupplierChanges from '@/components/seller-center/overview/OverviewRecentSupplierChanges';
import OverviewSourcingQueues from '@/components/seller-center/overview/OverviewSourcingQueues';
import OverviewSupplierAppsHealth, {
  type OverviewConnectionHealthRow,
} from '@/components/seller-center/overview/OverviewSupplierAppsHealth';
import { requirePermission } from '@/lib/auth/session';
import {
  oldestExceptionAgeMs,
  oldestInStatusAgeMs,
  type CandidateStatusCounts,
} from '@/modules/catalog/candidates/queries';
import {
  findSellerAccountByIdentityId,
  listActiveProviders,
  listConnectionsBySeller,
} from '@/modules/suppliers/repository';
import readCandidateStatusCounts from '@/modules/catalog/candidates/status-counts-cache';

export const metadata: Metadata = { title: 'Overview · Seller Center' };
export const dynamic = 'force-dynamic';

const EMPTY_COUNTS: CandidateStatusCounts = {
  ready: 0,
  needsAttention: 0,
  evaluating: 0,
  evaluatingQueued: 0,
  evaluatingProcessing: 0,
  blockedRejected: 0,
  exceptionQueue: 0,
};

/**
 * The Seller Center dashboard: what needs a seller now, and what the money
 * looks like. Only Product Sourcing queues and Supplier Apps health have a
 * real backend today (see the plan's own comparison table) - the other
 * three sections of the approved design state plainly what's missing
 * instead of showing fabricated figures.
 */
export default async function OverviewPage() {
  // Page access is `overview:read` (every role but `catalogue_reviewer`),
  // which is not the same axis as "has a verified Dropshipper seller
  // account" - unlike `/supplier-apps`, this page must render correctly for
  // a role with no seller account at all, not throw.
  const session = await requirePermission('overview:read');

  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Overview"
          description="What needs you now, and what the money looks like"
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so the real sourcing and connection data below cannot be read. This page works against a configured Postgres database - see the README."
        />
      </div>
    );
  }

  // Overview is the portal's landing page, so an unreachable database here is
  // the first thing a seller hits. It must explain itself rather than throw.
  const resolved = await readOrUnavailable('overview', async () => {
    const db = getDb();
    const sellerAccount = await findSellerAccountByIdentityId(
      db,
      session.userId,
    );
    const isEligibleSeller =
      sellerAccount !== null &&
      sellerAccount.accountState === 'ACTIVE' &&
      sellerAccount.verificationState === 'VERIFIED' &&
      sellerAccount.businessModel === 'DROPSHIPPER';

    const [sourcingCounts, providers, connections] = isEligibleSeller
      ? await Promise.all([
          readCandidateStatusCounts(sellerAccount.id),
          listActiveProviders(db),
          listConnectionsBySeller(db, sellerAccount.id),
        ])
      : [EMPTY_COUNTS, [], []];

    const [
      oldestReadyAgeMs,
      oldestNeedsAttentionAgeMs,
      oldestEvaluatingAgeMs,
      oldestBlockedRejectedAgeMs,
      exceptionAgeMs,
    ] = isEligibleSeller
      ? await Promise.all([
          oldestInStatusAgeMs(sellerAccount.id, ['PASS']),
          oldestInStatusAgeMs(sellerAccount.id, ['PASS_WITH_ATTENTION']),
          oldestInStatusAgeMs(sellerAccount.id, ['QUEUED', 'EVALUATING']),
          oldestInStatusAgeMs(sellerAccount.id, [
            'BLOCKED',
            'TEMPORARILY_INELIGIBLE',
          ]),
          oldestExceptionAgeMs(sellerAccount.id),
        ])
      : [null, null, null, null, null];

    const connectionRows: OverviewConnectionHealthRow[] = connections
      .map((connection) => {
        const provider = providers.find((p) => p.id === connection.providerId);
        return provider === undefined ? null : { provider, connection };
      })
      .filter((row): row is OverviewConnectionHealthRow => row !== null);

    return {
      sourcingCounts,
      connectionRows,
      oldestReadyAgeMs,
      oldestNeedsAttentionAgeMs,
      oldestEvaluatingAgeMs,
      oldestBlockedRejectedAgeMs,
      exceptionAgeMs,
    };
  });

  if (!resolved.ok) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Overview"
          description="What needs you now, and what the money looks like"
        />
        <SourcingEmptyState
          title="Cannot reach the database right now"
          description="Your sourcing queues and supplier health could not be read because the database did not respond. Nothing has been changed. Check that Postgres is running and that DATABASE_URL points at an existing database, then reload."
        />
      </div>
    );
  }

  const {
    sourcingCounts,
    connectionRows,
    oldestReadyAgeMs,
    oldestNeedsAttentionAgeMs,
    oldestEvaluatingAgeMs,
    oldestBlockedRejectedAgeMs,
    exceptionAgeMs,
  } = resolved.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Overview"
        description="What needs you now, and what the money looks like"
        actions={
          <LinkButton href="/listings/new?fixture=attention" size="default">
            Add Product
          </LinkButton>
        }
      />

      <OverviewNeedsYouNow />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <OverviewSourcingQueues
          counts={sourcingCounts}
          oldestReadyAgeMs={oldestReadyAgeMs}
          oldestNeedsAttentionAgeMs={oldestNeedsAttentionAgeMs}
          oldestEvaluatingAgeMs={oldestEvaluatingAgeMs}
          oldestBlockedRejectedAgeMs={oldestBlockedRejectedAgeMs}
          oldestExceptionAgeMs={exceptionAgeMs}
        />
        <OverviewMoneyPosition />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OverviewSupplierAppsHealth rows={connectionRows} />
        <OverviewRecentSupplierChanges />
      </div>
    </div>
  );
}
