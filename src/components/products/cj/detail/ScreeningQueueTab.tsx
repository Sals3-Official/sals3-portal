import DetailRow from '@/components/portal/DetailRow';
import DetailSection from '@/components/portal/DetailSection';
import { DiscoverySignalBadges } from '@/components/products/supplier-products/SupplierProductBadges';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import CandidateAbsentSection from './CandidateAbsentSection';
import QueueMechanicsSection from './QueueMechanicsSection';
import { ABSENT_COPY, CAVEAT_COPY, NEVER_RECORDED_COPY } from './copy';

/** Why the machine decided what it did, and what happens to this row next. */
export default function ScreeningQueueTab({
  detail,
}: {
  detail: CandidateDetail;
}) {
  const { candidate, evaluation, evidenceSummary, discoverySignals } = detail;

  return (
    <div className="flex flex-col gap-6">
      <DetailSection title="Screening findings">
        {evidenceSummary === null ? (
          <CandidateAbsentSection
            kind="not-fetched"
            message={ABSENT_COPY.notFetched}
          />
        ) : (
          <>
            <dl className="m-0">
              <DetailRow
                label="Usable images"
                value={evidenceSummary.usableImageCount}
              />
              <DetailRow
                label="Duplicate images"
                value={evidenceSummary.duplicateImageCount}
              />
              <DetailRow
                label="Variants"
                value={evidenceSummary.variantCount}
              />
              <DetailRow
                label="Variants with stock"
                value={evidenceSummary.variantsWithStock}
              />
              <DetailRow
                label="Total stock units"
                value={evidenceSummary.totalStockUnits ?? 'Not captured'}
              />
              <DetailRow
                label="Warehouses with stock"
                value={evidenceSummary.warehousesWithStock}
              />
              <DetailRow
                label="Reviews sampled"
                value={evidenceSummary.sampledReviewCount}
              />
              <DetailRow
                label="Sampled average score"
                value={evidenceSummary.sampledAverageScore ?? 'Not captured'}
              />
              {/* The caveat rides in the same row as the number, never as a footnote. */}
              <DetailRow
                label="Estimated margin"
                value={`${evidenceSummary.estimatedMarginPercent}%`}
                hint={CAVEAT_COPY.estimatedMargin}
              />
            </dl>
            {evidenceSummary.screeningNotes.length === 0 ? null : (
              <ul className="flex flex-col gap-1 text-sm text-ink-muted">
                {evidenceSummary.screeningNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </DetailSection>

      <QueueMechanicsSection evaluation={evaluation} />

      <DetailSection
        title={`CJ discovery signals (${discoverySignals.length})`}
      >
        {discoverySignals.length === 0 ? (
          <CandidateAbsentSection
            kind="never-recorded"
            message={NEVER_RECORDED_COPY.discoverySignals}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {discoverySignals.map((signal) => (
              <li key={signal.id} className="flex flex-col gap-1">
                <DiscoverySignalBadges signals={[signal.signal]} />
                <span className="text-xs text-ink-subtle">
                  Lane <span className="font-mono">{signal.sourceLane}</span>
                  {signal.sourceQuery === null
                    ? ''
                    : ` · query "${signal.sourceQuery}"`}
                  {signal.observedListedNum === null
                    ? ''
                    : ` · listedNum ${signal.observedListedNum}`}{' '}
                  · first {formatUtcDateTime(signal.firstObservedAt)} · last{' '}
                  {formatUtcDateTime(signal.lastObservedAt)} ·{' '}
                  {signal.observationCount} observations
                </span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="Provider freshness">
        <dl className="m-0">
          <DetailRow
            label="Last seen in a feed"
            value={formatUtcDateTime(candidate.providerLastSeenAt)}
          />
          <DetailRow
            label="Last verified"
            value={formatUtcDateTime(candidate.providerLastVerifiedAt)}
          />
          <DetailRow
            label="Removal suspected"
            value={formatUtcDateTime(
              candidate.providerRemovalSuspectedAt,
              'Not suspected',
            )}
          />
          <DetailRow
            label="Removal confirmed"
            value={
              candidate.providerRemovalConfirmedAt === null ? (
                'Not removed'
              ) : (
                <span className="rounded bg-danger-surface px-1.5 py-0.5 font-medium text-red-600">
                  Removed{' '}
                  {formatUtcDateTime(candidate.providerRemovalConfirmedAt)}
                </span>
              )
            }
          />
        </dl>
      </DetailSection>
    </div>
  );
}
