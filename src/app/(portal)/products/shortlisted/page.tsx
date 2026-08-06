import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import ShortlistedTable from '@/components/products/cj/ShortlistedTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import { requirePermission } from '@/lib/auth/session';
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
