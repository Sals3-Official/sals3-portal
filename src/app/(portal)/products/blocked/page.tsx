import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import BlockedCandidatesTable from '@/components/products/cj/BlockedCandidatesTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { listCandidatesByStatus } from '@/modules/catalog/candidates/queries';

export const metadata: Metadata = {
  title: 'Blocked / Rejected · Sals3 Portal',
};
export const dynamic = 'force-dynamic';

/**
 * Blocked / Rejected (spec's real page). Shows both permanent `BLOCKED`
 * decisions (no override) and retryable `TEMPORARILY_INELIGIBLE` ones
 * together, distinguished per row - see `BlockedCandidatesTable`.
 */
export default async function BlockedProductsPage() {
  const session = await requirePermission('catalog.candidate.read');

  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Blocked / Rejected"
          description="Permanent and retryable blocks"
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so blocked candidates cannot be read. This page works against a configured Postgres database - see the README."
        />
      </div>
    );
  }

  const candidates = await listCandidatesByStatus(session.sellerId, [
    'BLOCKED',
    'TEMPORARILY_INELIGIBLE',
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Blocked / Rejected"
        description={`${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'} blocked - permanent or retryable`}
      />
      {candidates.length === 0 ? (
        <SourcingEmptyState
          title="Nothing is blocked right now"
          description="Candidates the automated pipeline could not qualify - permanently or for now - appear here."
        />
      ) : (
        <BlockedCandidatesTable candidates={candidates} />
      )}
    </div>
  );
}
