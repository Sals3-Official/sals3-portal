import { closeCandidateHref } from '@/lib/portal/pipeline-params';
import resolveCandidateDetail from '@/modules/catalog/candidates/candidate-detail-queries';
import CandidateDetailSheet from './CandidateDetailSheet';
import CandidateDetailTabs from './detail/CandidateDetailTabs';
import CandidateMissingNotice from './detail/CandidateMissingNotice';
import presentEvaluationStatus from './evaluation-status';
import { displayName } from './candidate-view';

type CandidateDetailDrawerProps = {
  sellerAccountId: string;
  candidateId: string;
  currentParams: Record<string, string>;
};

/**
 * Server-side entry point for the detail drawer: fetches, then hands a fully
 * rendered tree to the one client component that owns the panel lifecycle.
 *
 * Lives here rather than in `page.tsx` so the page stays composition-only, and
 * so the fetch is not attempted when `?candidate=` is absent.
 */
export default async function CandidateDetailDrawer({
  sellerAccountId,
  candidateId,
  currentParams,
}: CandidateDetailDrawerProps) {
  const detail = await resolveCandidateDetail(sellerAccountId, candidateId);
  const closeHref = closeCandidateHref(currentParams);

  if (detail === null) {
    return (
      <CandidateDetailSheet
        closeHref={closeHref}
        candidateId={candidateId}
        title="Candidate detail"
      >
        <CandidateMissingNotice />
      </CandidateDetailSheet>
    );
  }

  const name = displayName({
    externalProductId: detail.candidate.externalProductId,
    // `displayName` prefers CJ evidence, then the feed snapshot, then the id.
    evidence: detail.snapshot?.evidence ?? null,
    evaluation: { feedSnapshot: detail.evaluation?.feedSnapshot ?? null },
  });
  const status =
    detail.evaluation === null
      ? 'Discovered, never queued for evaluation'
      : presentEvaluationStatus(
          detail.evaluation.status,
          detail.evaluation.attemptCount,
        ).label;

  return (
    <CandidateDetailSheet
      closeHref={closeHref}
      candidateId={candidateId}
      title={name}
      description={status}
    >
      <CandidateDetailTabs detail={detail} />
    </CandidateDetailSheet>
  );
}
