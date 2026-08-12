import Link from 'next/link';
import { X } from 'lucide-react';
import presentEvaluationStatus from '@/components/products/cj/evaluation-status';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { formatUsdCents } from '@/lib/cj/normalize';
import { buildHref } from '@/lib/portal/search-params';
import type { CandidateStockAttestationRow } from '@/lib/db/schema';
import type { SupplierProductRow } from '@/modules/catalog/candidates/supplier-products-queries';
import {
  DiscoverySignalBadges,
  StockReviewBadge,
} from './SupplierProductBadges';
import ManualStockCheckForm from './ManualStockCheckForm';

type SupplierSourceDetailsPanelProps = {
  product: SupplierProductRow;
  attestations: CandidateStockAttestationRow[];
  currentParams: Record<string, string>;
  /** Whether this actor may record a manual stock check. */
  canAttest: boolean;
};

function formatDate(value: Date | null): string {
  return value === null
    ? 'Not recorded'
    : value.toISOString().slice(0, 16).replace('T', ' ');
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  );
}

/**
 * **Supplier Source Details** - read-only, and read-only in the strong sense:
 * every value below is the Sals3 snapshot discovery already persisted, plus
 * the manual attestation history. Opening this panel makes ZERO supplier
 * requests. There is no refresh-from-CJ control, by decision, and no supplier
 * credential or supplier deep link is exposed here.
 *
 * The CJ product ID is shown as plain text so staff can look the product up
 * in their own CJ session. It is an identifier, not a credential, and it is
 * already visible in the table row.
 */
export default function SupplierSourceDetailsPanel({
  product,
  attestations,
  currentParams,
  canAttest,
}: SupplierSourceDetailsPanelProps) {
  const status = presentEvaluationStatus(product.status, product.attemptCount);

  return (
    <aside
      aria-label={`Supplier source details for ${product.name}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">
            Supplier Source Details
          </h2>
          <p className="truncate text-sm text-ink-muted" title={product.name}>
            {product.name}
          </p>
        </div>
        <Link
          href={buildHref('/products', currentParams, { source: null })}
          aria-label="Close supplier source details"
          className="rounded-md border border-border p-1 text-ink-muted hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-4" />
        </Link>
      </div>

      <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-ink-muted">
        This is the saved Sals3 snapshot of the supplier listing, captured when
        discovery last saw this product. Opening this panel does not contact the
        supplier and spends no CJ API points.
      </p>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="CJ product ID" value={product.externalProductId} />
        <Field label="Supplier SKU" value={product.sku ?? 'Not captured'} />
        <Field
          label="Provider category"
          value={
            product.categoryName === null
              ? 'Not captured'
              : `${product.categoryName}${product.categoryId === null ? '' : ` (${product.categoryId})`}`
          }
        />
        <Field
          label="Supplier price"
          value={formatUsdCents(product.priceUsdCents)}
        />
        <Field label="Weight" value={product.weight ?? 'Not captured'} />
        <Field
          label="Ships from"
          value={
            product.shipsFrom.length === 0
              ? 'Not captured'
              : product.shipsFrom.join(', ')
          }
        />
        <Field
          label="CJ listings (listedNum)"
          value={
            product.listedCount === null
              ? 'Not captured'
              : `${product.listedCount} — platform listings, not units sold`
          }
        />
        <Field
          label="Created on CJ"
          value={product.providerCreatedAt ?? 'Not captured'}
        />
        <Field
          label="First discovered"
          value={formatDate(product.discoveredAt)}
        />
        <Field
          label="Last seen by discovery"
          value={formatDate(product.providerLastSeenAt)}
        />
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Screening</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={status.label} tone={status.tone} />
          <DiscoverySignalBadges signals={product.signals} />
        </div>
        <p className="text-xs text-ink-muted">{status.description}</p>
        {product.reasonCodes.length === 0 ? null : (
          <p className="text-xs text-ink-muted">
            Reasons: {product.reasonCodes.join(', ')}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Stock review</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StockReviewBadge state={product.stockReview.state} />
          <span className="text-xs text-ink-muted">
            Last recorded {formatDate(product.stockReview.recordedAt)}
          </span>
        </div>
        {product.stockReview.state === 'STOCK_NOT_CHECKED' ? (
          <p className="text-xs text-ink-muted">
            No one has inspected this product yet. Sals3 does not query the CJ
            inventory API for raw supplier products.
          </p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Observed at"
              value={formatDate(product.stockReview.observedAt)}
            />
            <Field
              label="Recorded by"
              value={product.stockReview.actorId ?? 'Unknown'}
            />
            <Field
              label="Observed quantity"
              value={
                product.stockReview.observedQuantity === null
                  ? 'Not recorded'
                  : String(product.stockReview.observedQuantity)
              }
            />
            <Field
              label="Observed origin"
              value={product.stockReview.observedOrigin ?? 'Not recorded'}
            />
            <div className="sm:col-span-2">
              <Field
                label="Note"
                value={product.stockReview.note ?? 'No note'}
              />
            </div>
          </dl>
        )}
      </div>

      {canAttest ? (
        <ManualStockCheckForm
          candidateId={product.candidateId}
          expectedVersion={product.stockReview.version}
          currentState={product.stockReview.state}
        />
      ) : (
        <p className="text-xs text-ink-muted">
          You can view this record but not record a stock check.
        </p>
      )}

      {attestations.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Inspection history</h3>
          <ul className="flex flex-col gap-1.5">
            {attestations.map((entry) => (
              <li key={entry.id} className="text-xs text-ink-muted">
                <StockReviewBadge state={entry.state} className="mr-2" />
                {formatDate(entry.observedAt)} · {entry.actorId}
                {entry.observedQuantity === null
                  ? ''
                  : ` · qty ${entry.observedQuantity}`}
                {entry.observedOrigin === null
                  ? ''
                  : ` · ${entry.observedOrigin}`}
                {entry.note === null || entry.note === ''
                  ? ''
                  : ` · ${entry.note}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
