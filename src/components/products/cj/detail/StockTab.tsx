import DetailRow from '@/components/portal/DetailRow';
import DetailSection from '@/components/portal/DetailSection';
import { StockReviewBadge } from '@/components/products/supplier-products/SupplierProductBadges';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import CandidateAbsentSection from './CandidateAbsentSection';
import CjObservedStockSection from './CjObservedStockSection';
import { NEVER_RECORDED_COPY } from './copy';

/**
 * Can this actually be sold.
 *
 * The manual attestation sits ABOVE the CJ evidence deliberately: under ADR-013
 * a staff attestation is the only record that means "someone confirmed stock",
 * and CJ evidence exists for 19 of 87,966 candidates. Putting evidence first
 * would lead with an empty state on nearly every row.
 */
export default function StockTab({ detail }: { detail: CandidateDetail }) {
  const { candidate, attestations, snapshot } = detail;
  const notChecked = candidate.stockReviewState === 'STOCK_NOT_CHECKED';

  return (
    <div className="flex flex-col gap-6">
      <DetailSection title="Manual stock review">
        <StockReviewBadge
          state={candidate.stockReviewState}
          className="w-fit"
        />
        {notChecked ? (
          <CandidateAbsentSection
            kind="never-recorded"
            message={NEVER_RECORDED_COPY.attestations}
          />
        ) : (
          <dl className="m-0">
            <DetailRow
              label="Observed quantity"
              value={candidate.stockReviewObservedQuantity ?? 'Not captured'}
            />
            <DetailRow
              label="Observed origin"
              value={candidate.stockReviewObservedOrigin ?? 'Not captured'}
            />
            <DetailRow
              label="Observed"
              value={formatUtcDateTime(candidate.stockReviewObservedAt)}
            />
            <DetailRow
              label="Recorded"
              value={formatUtcDateTime(candidate.stockReviewRecordedAt)}
            />
            <DetailRow
              label="Recorded by"
              value={candidate.stockReviewActorId ?? 'Not captured'}
              mono
            />
            <DetailRow label="Revision" value={candidate.stockReviewVersion} />
            <DetailRow
              label="Note"
              value={candidate.stockReviewNote ?? 'Not captured'}
            />
          </dl>
        )}
      </DetailSection>

      <DetailSection
        title={`Inspection history (${attestations.length})`}
        note="Append-only. A newer inspection supersedes an older one without erasing it."
      >
        {attestations.length === 0 ? (
          <CandidateAbsentSection
            kind="never-recorded"
            message={NEVER_RECORDED_COPY.attestations}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {attestations.map((attestation) => (
              <li
                key={attestation.id}
                className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StockReviewBadge state={attestation.state} />
                  <span className="text-xs text-ink-muted">
                    {formatUtcDateTime(attestation.observedAt)}
                  </span>
                </span>
                <span className="text-xs text-ink-subtle">
                  Recorded {formatUtcDateTime(attestation.createdAt)} by{' '}
                  <span className="font-mono">{attestation.actorId}</span>,
                  superseding revision {attestation.supersededVersion}
                  {attestation.observedQuantity === null
                    ? ''
                    : ` · ${attestation.observedQuantity} units`}
                  {attestation.observedOrigin === null
                    ? ''
                    : ` · ${attestation.observedOrigin}`}
                </span>
                {attestation.note === null ? null : (
                  <span className="text-sm">{attestation.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <CjObservedStockSection snapshot={snapshot} />
    </div>
  );
}
