import DetailSection from '@/components/portal/DetailSection';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import CandidateAbsentSection from './CandidateAbsentSection';
import { ABSENT_COPY } from './copy';

type CjObservedStockSectionProps = {
  snapshot: CandidateDetail['snapshot'];
};

/**
 * Per-origin CJ inventory, from the captured snapshot.
 *
 * This lives here rather than in the Supplier evidence tab because
 * `CandidateEvidencePanel` collapses each variant's origins into one summed
 * number, and the raw per-origin components - CJ warehouse stock versus
 * factory-backed stock, and whether the warehouse is verified - are the whole
 * reason the schema preserves them separately. A summed total cannot answer
 * "is any of this in a verified warehouse".
 */
export default function CjObservedStockSection({
  snapshot,
}: CjObservedStockSectionProps) {
  if (snapshot === null) {
    return (
      <DetailSection title="CJ-observed stock">
        <CandidateAbsentSection
          kind="not-fetched"
          message={ABSENT_COPY.notFetched}
        />
      </DetailSection>
    );
  }

  const origins = snapshot.evidence.variants.flatMap((variant) =>
    variant.stockByOrigin.map((origin) => ({ variant, origin })),
  );

  return (
    <DetailSection title="CJ-observed stock">
      {origins.length === 0 ? (
        <CandidateAbsentSection
          kind="reported-zero"
          capturedAt={snapshot.capturedAt}
          message="CJ reported no stocked origin for any variant."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {origins.map(({ variant, origin }) => (
            <li
              key={`${variant.vid}-${origin.countryCode}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border pb-1.5 text-sm last:border-b-0"
            >
              <span>
                {variant.optionLabel || variant.sku} · {origin.countryCode}
              </span>
              <span className="text-ink-muted tabular-nums">
                CJ {origin.cjInventory ?? 'not reported'} · factory{' '}
                {origin.factoryInventory ?? 'not reported'} · total{' '}
                {origin.totalInventory ?? 'not reported'} ·{' '}
                {origin.verifiedWarehouse}
              </span>
            </li>
          ))}
        </ul>
      )}

      {snapshot.evidence.warehouses.length === 0 ? (
        <CandidateAbsentSection
          kind="reported-zero"
          capturedAt={snapshot.capturedAt}
          message="No warehouse held stock."
        />
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {snapshot.evidence.warehouses.map((warehouse) => (
            <li
              key={warehouse.countryCode}
              className="flex justify-between gap-3"
            >
              <span>{warehouse.name}</span>
              <span className="text-ink-muted tabular-nums">
                {warehouse.totalInventory ?? 'not reported'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
