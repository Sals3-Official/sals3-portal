import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import QualifiedCandidatesTable from '@/components/products/cj/QualifiedCandidatesTable';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { isDatabaseConfigured } from '@/lib/db/client';
import { listCandidatesByStatus } from '@/modules/catalog/candidates/queries';

export const metadata: Metadata = { title: 'Needs Attention · Sals3 Portal' };
export const dynamic = 'force-dynamic';

/**
 * Qualified Products - Needs Attention. `PASS_WITH_ATTENTION` candidates:
 * still eligible for "Customize & List", shown with their warning reasons.
 * No push/email notification fires for these (spec's UI corrections) - only
 * the persistent screen itself.
 */
export default async function NeedsAttentionProductsPage() {
  // See ready/page.tsx's identical comment: this must run before
  // `requireDropshipperAccount()`, which reaches the database immediately.
  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Needs Attention"
          description="Qualified Products · Needs Attention"
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so evaluated candidates cannot be read. This page works against a configured Postgres database - see the README."
        />
      </div>
    );
  }

  const { sellerAccount } = await requireDropshipperAccount();
  const candidates = await listCandidatesByStatus(sellerAccount.id, [
    'PASS_WITH_ATTENTION',
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Needs Attention"
        description={`${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'} passed with a warning`}
      />
      <SourcingInfoBanner>
        These passed automatic checks, but with a warning flagged - read the
        reason before you decide whether to list. They are still eligible to
        customize and list, unlike Blocked / Rejected.
      </SourcingInfoBanner>
      {candidates.length === 0 ? (
        <SourcingEmptyState
          title="No candidates need attention"
          description="Candidates with a warning - but still eligible to customize and list - appear here automatically."
        />
      ) : (
        <QualifiedCandidatesTable candidates={candidates} showReasons />
      )}
    </div>
  );
}
