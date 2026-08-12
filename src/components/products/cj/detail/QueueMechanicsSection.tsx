import DetailRow from '@/components/portal/DetailRow';
import DetailSection from '@/components/portal/DetailSection';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import { MAX_EVALUATION_ATTEMPTS } from '@/modules/catalog/candidates/rules/policy';
import explainLastErrorCode from '../last-error-code';
import CandidateAbsentSection from './CandidateAbsentSection';
import { ABSENT_COPY, CAVEAT_COPY } from './copy';

type QueueMechanicsSectionProps = {
  evaluation: CandidateDetail['evaluation'];
};

/**
 * Queue state and decision provenance - why a row is where it is, and what will
 * happen to it next.
 *
 * The lease fields are internal worker bookkeeping. They are shown anyway,
 * labelled as such: without them a row stuck mid-evaluation is unexplainable
 * from the UI, and "no visible reason" is worse than one honest internal field.
 */
export default function QueueMechanicsSection({
  evaluation,
}: QueueMechanicsSectionProps) {
  if (evaluation === null) {
    return (
      <DetailSection title="Queue mechanics">
        <CandidateAbsentSection
          kind="never-recorded"
          message={ABSENT_COPY.neverQueued}
        />
      </DetailSection>
    );
  }

  return (
    <>
      <DetailSection title="Queue mechanics" note={CAVEAT_COPY.workerLease}>
        <dl className="m-0">
          <DetailRow
            label="Attempts"
            value={`${evaluation.attemptCount} of ${MAX_EVALUATION_ATTEMPTS}`}
          />
          <DetailRow
            label="Last error"
            value={
              evaluation.lastErrorCode === null
                ? 'None'
                : explainLastErrorCode(evaluation.lastErrorCode)
            }
            hint={evaluation.lastErrorCode ?? undefined}
          />
          <DetailRow
            label="Next retry"
            value={formatUtcDateTime(evaluation.nextRetryAt, 'Not scheduled')}
          />
          <DetailRow
            label="Next refresh"
            value={formatUtcDateTime(evaluation.nextRefreshAt, 'Not scheduled')}
          />
          <DetailRow
            label="Why last queued"
            value={evaluation.admissionReason ?? 'Not recorded'}
          />
          <DetailRow
            label="Leased by"
            value={evaluation.leasedBy ?? 'Not leased'}
            mono
          />
          <DetailRow
            label="Lease expires"
            value={formatUtcDateTime(evaluation.leasedUntil, 'Not leased')}
          />
          <DetailRow
            label="Row created"
            value={formatUtcDateTime(evaluation.createdAt)}
          />
          <DetailRow
            label="Row updated"
            value={formatUtcDateTime(evaluation.updatedAt)}
          />
        </dl>
      </DetailSection>

      <DetailSection title="Decision provenance">
        <dl className="m-0">
          <DetailRow
            label="Snapshot checksum used"
            value={evaluation.sourceSnapshotChecksum ?? 'None'}
            mono
          />
          <DetailRow
            label="Last seen fingerprint"
            value={evaluation.lastSeenFingerprint}
            mono
          />
          <DetailRow
            label="Policy version"
            value={evaluation.policyVersion}
            mono
          />
        </dl>
      </DetailSection>
    </>
  );
}
