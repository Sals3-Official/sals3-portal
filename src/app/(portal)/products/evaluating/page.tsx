import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import EvaluatingCandidatesTable from '@/components/products/cj/EvaluatingCandidatesTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import { listCandidatesByStatus } from '@/modules/catalog/candidates/queries';

export const metadata: Metadata = { title: 'Evaluating · Sals3 Portal' };
export const dynamic = 'force-dynamic';

/** Candidates the automated pipeline has queued or is actively evaluating. */
export default async function EvaluatingProductsPage() {
  const { sellerAccount } = await requireDropshipperAccount();

  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Evaluating"
          description="Candidates queued or in progress"
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so queued candidates cannot be read. This page works against a configured Postgres database - see the README."
        />
      </div>
    );
  }

  const candidates = await listCandidatesByStatus(sellerAccount.id, [
    'QUEUED',
    'EVALUATING',
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Evaluating"
        description={`${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'} queued or in progress`}
      />
      <SourcingInfoBanner>
        Products the automatic pipeline is checking right now - pricing, stock,
        and policy checks run here before a product can move to Ready, Needs
        Attention, or Blocked. This list clears on its own as checks finish;
        nothing to do here.
      </SourcingInfoBanner>
      {candidates.length === 0 ? (
        <SourcingEmptyState
          title="Nothing is queued right now"
          description="New and changed CJ products are picked up automatically by the ingestion job."
        />
      ) : (
        <EvaluatingCandidatesTable candidates={candidates} />
      )}
    </div>
  );
}
