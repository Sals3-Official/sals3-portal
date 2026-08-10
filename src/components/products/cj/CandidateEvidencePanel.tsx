import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import type { StockEvidenceLabel } from '@/lib/cj/stock-evidence';

type CandidateEvidencePanelProps = {
  evidence: CandidateEvidence;
};

function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

function formatStock(value: number | null): string {
  return value === null ? 'not reported' : String(value);
}

/** Plain evidence labels only — never a claim about a confirmed freight route (ADR-013). */
const STOCK_EVIDENCE_TEXT: Record<StockEvidenceLabel, string> = {
  CJ_WAREHOUSE_STOCK: 'CJ warehouse stock',
  FACTORY_BACKED_STOCK: 'Factory-backed stock',
  MIXED_STOCK: 'Mixed CJ/factory stock',
  ZERO_STOCK: 'No stocked origin observed',
  UNKNOWN_STOCK: 'Stock evidence unknown',
};

/**
 * Fresh CJ evidence for one candidate (spec section 8.3).
 *
 * Facts only. There is no score, no decision, and no "good/bad" verdict
 * anywhere here, because the gates and scoring that would produce one are not
 * implemented. Two labelling rules are load-bearing:
 *  - review numbers are CJ supplier-platform evidence, never Sals3 ratings;
 *  - `listedCount` is CJ's platform listing count, never units sold.
 *
 * The supplier description is deliberately not rendered: it is raw supplier
 * HTML, and nothing sanitises it yet.
 */
export default function CandidateEvidencePanel({
  evidence,
}: CandidateEvidencePanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          Supplier facts
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-muted">Supplier SKU</dt>
          <dd className="font-mono text-xs">{evidence.supplierSku || '—'}</dd>
          <dt className="text-ink-muted">CJ category</dt>
          <dd>{evidence.categoryName || '—'}</dd>
          <dt className="text-ink-muted">Supplier price</dt>
          <dd className="tabular-nums">
            {formatUsd(evidence.supplierPriceUsd)}
          </dd>
          <dt className="text-ink-muted">Packed weight</dt>
          <dd>{evidence.packedWeight ? `${evidence.packedWeight} g` : '—'}</dd>
          <dt className="text-ink-muted">Usable images</dt>
          <dd className="tabular-nums">{evidence.usableImageCount}</dd>
          <dt className="text-ink-muted">Platform listings</dt>
          <dd className="tabular-nums">{evidence.listedCount ?? '—'}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          Platform listings is how many CJ sellers list this product. It is not
          a sales, order, or customer count.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          Variants ({evidence.variants.length})
        </h3>
        {evidence.variants.length === 0 ? (
          <p className="text-sm text-ink-muted">CJ reported no variants.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {evidence.variants.map((variant) => (
              <li
                key={variant.vid}
                className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border pb-1.5 last:border-b-0"
              >
                <span className="font-medium">
                  {variant.optionLabel || '—'}
                </span>
                <span className="tabular-nums text-ink-muted">
                  {formatUsd(variant.priceUsd)} · stock{' '}
                  {formatStock(variant.totalInventory)} ·{' '}
                  {STOCK_EVIDENCE_TEXT[variant.stockEvidence]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          Warehouses
        </h3>
        {evidence.warehouses.length === 0 ? (
          <p className="text-sm text-ink-muted">
            CJ reported no warehouse stock.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {evidence.warehouses.map((warehouse) => (
              <li
                key={warehouse.countryCode}
                className="flex justify-between gap-3"
              >
                <span>{warehouse.name}</span>
                <span className="tabular-nums text-ink-muted">
                  {formatStock(warehouse.totalInventory)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
          CJ review evidence
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-ink-muted">Reviews on CJ</dt>
          <dd className="tabular-nums">{evidence.reviews.totalCount}</dd>
          <dt className="text-ink-muted">Sampled</dt>
          <dd className="tabular-nums">{evidence.reviews.sampledCount}</dd>
          <dt className="text-ink-muted">Sampled average</dt>
          <dd className="tabular-nums">
            {evidence.reviews.sampledAverageScore === null
              ? '—'
              : evidence.reviews.sampledAverageScore.toFixed(1)}
          </dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          These are CJ supplier-platform reviews, not Sals3 buyer reviews, and
          are never shown to customers. The average covers only the sampled page
          and is not confidence-adjusted.
        </p>
      </section>

      {evidence.isTestProduct ? (
        <StatusPill label="CJ marks this a test product" tone="warning" />
      ) : null}

      <p className="text-xs text-muted-foreground">
        Evidence captured {new Date(evidence.capturedAt).toLocaleString()}.
      </p>
    </div>
  );
}
