import DetailRow from '@/components/portal/DetailRow';
import DetailSection from '@/components/portal/DetailSection';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import {
  PERMANENT_REASON_CODES,
  type ReasonCode,
} from '@/modules/catalog/candidates/rules/contracts';
import { explainReasonCode } from '@/lib/products/catalog-presentation';
import presentEvaluationStatus from '../evaluation-status';
import explainLastErrorCode from '../last-error-code';
import { formatUsd } from '../candidate-view';
import CandidateAbsentSection from './CandidateAbsentSection';
import { ABSENT_COPY, CAVEAT_COPY } from './copy';

/** A dash means "empty"; these fields mean "we never captured it". */
function orNotCaptured(value: string | null | undefined): string {
  return value === null || value === undefined || value === ''
    ? 'Not captured'
    : value;
}

function ReasonCodeList({ codes }: { codes: ReasonCode[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {codes.map((code) => (
        <li key={code} className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusPill label={code} tone="warning" />
            <StatusPill
              label={
                PERMANENT_REASON_CODES.includes(code)
                  ? 'Permanent'
                  : 'Retryable'
              }
              tone={
                PERMANENT_REASON_CODES.includes(code) ? 'danger' : 'neutral'
              }
            />
          </span>
          <span className="text-xs text-ink-subtle">
            {explainReasonCode(code)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What this candidate is, and what the system decided about it.
 *
 * `score` is deliberately not rendered as a value. The column is reserved and
 * always null, and a `—` beside a label called "Score" reads as "scored zero".
 * `CAVEAT_COPY.noScore` says so in words instead.
 */
export default function OverviewTab({ detail }: { detail: CandidateDetail }) {
  const { candidate, connection, evaluation, feedSnapshot } = detail;
  const status =
    evaluation === null
      ? null
      : presentEvaluationStatus(evaluation.status, evaluation.attemptCount);
  const reasonCodes = (evaluation?.reasonCodes ?? []) as ReasonCode[];

  return (
    <div className="flex flex-col gap-6">
      <DetailSection title="Identity">
        <dl className="m-0">
          <DetailRow label="Supplier" value={candidate.supplier} />
          <DetailRow
            label="Supplier product ID"
            value={candidate.externalProductId}
            mono
            hint={CAVEAT_COPY.externalIdLookup}
          />
          <DetailRow
            label="Supplier category"
            value={orNotCaptured(candidate.providerCategoryName)}
          />
          <DetailRow
            label="Supplier category ID"
            value={orNotCaptured(candidate.providerCategoryId)}
            mono
          />
          <DetailRow label="Pipeline state" value={candidate.shortlistState} />
          <DetailRow
            label="Intended markets"
            value={
              candidate.intendedMarketCodes.length === 0
                ? 'None recorded'
                : candidate.intendedMarketCodes.join(', ')
            }
          />
          <DetailRow label="Connection status" value={connection.status} />
          <DetailRow
            label="First discovered"
            value={formatUtcDateTime(candidate.createdAt)}
          />
          <DetailRow
            label="Last updated"
            value={formatUtcDateTime(candidate.updatedAt)}
          />
        </dl>
      </DetailSection>

      <DetailSection title="Decision" note={CAVEAT_COPY.noScore}>
        {status === null || evaluation === null ? (
          <CandidateAbsentSection
            kind="never-recorded"
            message={ABSENT_COPY.neverQueued}
          />
        ) : (
          <>
            <StatusPill
              label={status.label}
              tone={status.tone}
              className="w-fit"
            />
            <p className="text-sm text-ink-muted">{status.description}</p>
            <dl className="m-0">
              <DetailRow
                label="Policy version"
                value={evaluation.policyVersion}
                mono
              />
              <DetailRow
                label="Evaluated"
                value={formatUtcDateTime(evaluation.evaluatedAt)}
              />
              {evaluation.lastErrorCode === null ? null : (
                <DetailRow
                  label="Last error"
                  value={explainLastErrorCode(evaluation.lastErrorCode)}
                  hint={evaluation.lastErrorCode}
                />
              )}
            </dl>
            {reasonCodes.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No attention or rejection reason was recorded.
              </p>
            ) : (
              <ReasonCodeList codes={reasonCodes} />
            )}
          </>
        )}
      </DetailSection>

      <DetailSection title="Price at a glance">
        <dl className="m-0">
          <DetailRow
            label="Supplier price"
            value={formatUsd(
              feedSnapshot?.priceUsdCents == null
                ? null
                : feedSnapshot.priceUsdCents / 100,
            )}
          />
          <DetailRow
            label="Last known price"
            value={formatUsd(
              evaluation?.lastKnownPriceUsdCents == null
                ? null
                : evaluation.lastKnownPriceUsdCents / 100,
            )}
          />
          <DetailRow
            label="Free shipping"
            value={
              feedSnapshot?.freeShipping == null
                ? 'Not captured'
                : String(feedSnapshot.freeShipping)
            }
          />
          <DetailRow
            label="Ships from"
            value={
              feedSnapshot === null || feedSnapshot.shipsFrom.length === 0
                ? 'Not captured'
                : feedSnapshot.shipsFrom.join(', ')
            }
          />
        </dl>
      </DetailSection>
    </div>
  );
}
