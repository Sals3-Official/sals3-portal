import DetailSection from '@/components/portal/DetailSection';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import CandidateAbsentSection from './CandidateAbsentSection';
import AuditTrailSection from './AuditTrailSection';
import { CAVEAT_COPY, NEVER_RECORDED_COPY } from './copy';

/** What people and systems did to this row. */
export default function HistoryTab({ detail }: { detail: CandidateDetail }) {
  const { auditEvents, productOverrides, variantOverrides, productReferences } =
    detail;
  const overrideCount = productOverrides.length + variantOverrides.length;

  return (
    <div className="flex flex-col gap-6">
      <AuditTrailSection events={auditEvents} />

      <DetailSection
        title={`Pricing overrides (${overrideCount})`}
        note={CAVEAT_COPY.pricingOverrideAudit}
      >
        {overrideCount === 0 ? (
          <CandidateAbsentSection
            kind="never-recorded"
            message={NEVER_RECORDED_COPY.pricingOverrides}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {productOverrides.map((override) => (
              <li
                key={override.id}
                className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={override.status}
                    tone={override.status === 'ACTIVE' ? 'success' : 'neutral'}
                  />
                  <span className="text-sm">
                    Product margin {override.targetMarginRate} · revision{' '}
                    {override.version}
                  </span>
                </span>
                <span className="text-xs text-ink-subtle">
                  {formatUtcDateTime(override.createdAt)} by{' '}
                  <span className="font-mono">{override.actorId}</span>
                </span>
                <span className="text-sm">{override.reason}</span>
              </li>
            ))}
            {variantOverrides.map((override) => (
              <li
                key={override.id}
                className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={override.status}
                    tone={override.status === 'ACTIVE' ? 'success' : 'neutral'}
                  />
                  <span className="text-sm">
                    Variant{' '}
                    <span className="font-mono text-xs">
                      {override.supplierVariantId}
                    </span>{' '}
                    margin {override.targetMarginRate} · revision{' '}
                    {override.version}
                  </span>
                </span>
                <span className="text-xs text-ink-subtle">
                  {formatUtcDateTime(override.createdAt)} by{' '}
                  <span className="font-mono">{override.actorId}</span>
                </span>
                <span className="text-sm">{override.reason}</span>
                <span className="text-sm text-ink-muted">
                  {override.additionalJustification}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="Drafted into a Sals3 product">
        {productReferences.length === 0 ? (
          <CandidateAbsentSection
            kind="never-recorded"
            message={NEVER_RECORDED_COPY.productReferences}
          />
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {productReferences.map((reference) => (
              <li key={reference.id} className="flex flex-col gap-0.5">
                <span>
                  Source status {reference.sourceStatus} · sync{' '}
                  {reference.syncState}
                </span>
                <span className="text-xs text-ink-subtle">
                  Snapshot{' '}
                  <span className="font-mono">
                    {reference.snapshotChecksum ?? 'none'}
                  </span>{' '}
                  · last observed {formatUtcDateTime(reference.lastObservedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
    </div>
  );
}
