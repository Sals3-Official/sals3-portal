import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import QualifiedCandidatesTable from '@/components/products/cj/QualifiedCandidatesTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { listCandidatesByStatus } from '@/modules/catalog/candidates/queries';

export const metadata: Metadata = { title: 'Ready · Sals3 Portal' };
export const dynamic = 'force-dynamic';

/**
 * Qualified Products - Ready (default Product Sourcing screen). Every row
 * here passed automated evaluation with no open issue (`PASS`) and arrived
 * without anyone clicking a row - the seller reviews outcomes, the pipeline
 * produces them.
 */
export default async function ReadyProductsPage() {
  const session = await requirePermission('catalog.candidate.read');

  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Ready" description="Qualified Products · Ready" />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so evaluated candidates cannot be read. This page works against a configured Postgres database - see the README."
        />
      </div>
    );
  }

  const candidates = await listCandidatesByStatus(session.sellerId, ['PASS']);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Ready"
        description={`${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'} passed automated evaluation with no open issue`}
      />
      {candidates.length === 0 ? (
        <SourcingEmptyState
          title="No candidates are ready yet"
          description="The automated evaluation pipeline populates this screen on its own as CJ products pass every check."
        />
      ) : (
        <QualifiedCandidatesTable candidates={candidates} showReasons={false} />
      )}
    </div>
  );
}
