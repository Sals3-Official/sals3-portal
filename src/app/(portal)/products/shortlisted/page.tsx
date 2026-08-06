import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import ShortlistedTable from '@/components/products/cj/ShortlistedTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import listShortlistedCandidates from '@/modules/catalog/candidates/queries';

export const metadata: Metadata = { title: 'Shortlisted · Sals3 Portal' };

/**
 * Shortlisted CJ candidates (spec section 8.14) — real rows from Postgres,
 * scoped to the session's seller. Not cached: a shortlist changes the moment
 * an employee clicks "Check for Sals3".
 */
export const dynamic = 'force-dynamic';

export default async function ShortlistedPage() {
  const session = await requirePermission('catalog.candidate.read');

  // An environment with no database is expected, not broken: preview deploys
  // and CI have none. Say so instead of throwing a 500.
  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Shortlisted"
          description="CJ candidates saved for Sals3"
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so shortlisted candidates cannot be read. This page works against a configured Postgres database — see the README."
        />
      </div>
    );
  }

  const candidates = await listShortlistedCandidates(session.sellerId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Shortlisted"
        description={`${candidates.length} CJ ${
          candidates.length === 1 ? 'candidate' : 'candidates'
        } saved for Sals3`}
      />
      {candidates.length === 0 ? (
        <SourcingEmptyState
          title="No shortlisted candidates yet"
          description='Open the CJ Candidate Explorer and use "Check for Sals3" on a supplier product to shortlist it.'
        />
      ) : (
        <ShortlistedTable candidates={candidates} />
      )}
    </div>
  );
}
