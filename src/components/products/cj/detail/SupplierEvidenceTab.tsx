import DetailRow from '@/components/portal/DetailRow';
import DetailSection from '@/components/portal/DetailSection';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import CandidateEvidencePanel from '../CandidateEvidencePanel';
import CandidateAbsentSection from './CandidateAbsentSection';
import { ABSENT_COPY, CAVEAT_COPY } from './copy';

function orNotCaptured(value: string | null | undefined): string {
  return value === null || value === undefined || value === ''
    ? 'Not captured'
    : value;
}

/**
 * Everything CJ told us, in two layers.
 *
 * The feed snapshot leads because it is written for every candidate at discovery
 * time, so the usual case does not open with an empty state. The detail
 * evidence, which exists for 19 of 87,966 candidates, follows.
 */
export default function SupplierEvidenceTab({
  detail,
}: {
  detail: CandidateDetail;
}) {
  const { feedSnapshot, snapshot } = detail;

  return (
    <div className="flex flex-col gap-6">
      <DetailSection title="What discovery captured">
        {feedSnapshot === null ? (
          <CandidateAbsentSection
            kind="never-recorded"
            message={ABSENT_COPY.neverQueued}
          />
        ) : (
          <dl className="m-0">
            <DetailRow label="Name" value={feedSnapshot.name} />
            <DetailRow label="Category" value={feedSnapshot.category} />
            <DetailRow
              label="Category ID"
              value={orNotCaptured(feedSnapshot.categoryId)}
              mono
            />
            <DetailRow
              label="SKU"
              value={orNotCaptured(feedSnapshot.sku)}
              mono
            />
            <DetailRow
              label="Platform listings"
              value={feedSnapshot.listedCount ?? 'Not captured'}
              hint={CAVEAT_COPY.listedCount}
            />
            <DetailRow
              label="Weight"
              value={orNotCaptured(feedSnapshot.weight)}
            />
            <DetailRow
              label="Product type"
              value={orNotCaptured(feedSnapshot.productType)}
            />
            <DetailRow
              label="Supplier name"
              value={orNotCaptured(feedSnapshot.supplierName)}
            />
            <DetailRow
              label="Created on CJ"
              value={orNotCaptured(feedSnapshot.providerCreatedAt)}
            />
          </dl>
        )}
      </DetailSection>

      <DetailSection title="CJ detail evidence">
        {snapshot === null ? (
          <CandidateAbsentSection
            kind="not-fetched"
            message={ABSENT_COPY.notFetched}
          />
        ) : (
          <CandidateEvidencePanel evidence={snapshot.evidence} />
        )}
      </DetailSection>

      {snapshot === null ? null : (
        <>
          <DetailSection
            title="Raw supplier fields"
            note={CAVEAT_COPY.rawSupplierFields}
          >
            <dl className="m-0">
              <DetailRow
                label="Customs code"
                value={orNotCaptured(snapshot.evidence.entryCode)}
                mono
              />
              <DetailRow
                label="Source status"
                value={orNotCaptured(snapshot.evidence.sourceStatusRaw)}
              />
            </dl>
            {snapshot.evidence.isTestProduct ? (
              <StatusPill
                label="CJ marks this a test product"
                tone="warning"
                className="w-fit"
              />
            ) : null}
          </DetailSection>

          <DetailSection title="Snapshot provenance">
            <dl className="m-0">
              <DetailRow
                label="Schema version"
                value={orNotCaptured(snapshot.schemaVersion)}
                mono
              />
              <DetailRow label="Checksum" value={snapshot.checksum} mono />
              <DetailRow
                label="Captured"
                value={formatUtcDateTime(snapshot.capturedAt)}
              />
            </dl>
          </DetailSection>
        </>
      )}
    </div>
  );
}
