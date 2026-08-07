import { Package } from 'lucide-react';
import {
  estimatePhpMinor,
  formatMinorUnits,
  formatPhpEstimate,
  STOCK_TEXT,
} from '@/lib/products/catalog-presentation';
import type {
  CatalogFxRates,
  SupplierConnectionFixture,
  SupplierProductFixture,
} from '@/lib/products/catalog-types';
import EvaluationStatusPill from './EvaluationStatusPill';
import EvidenceFreshness from './EvidenceFreshness';
import PotentialDuplicateIndicator from './PotentialDuplicateIndicator';
import SupplierIdentity from './SupplierIdentity';

type SupplierProductCardProps = {
  product: SupplierProductFixture;
  connection: SupplierConnectionFixture;
  rates: CatalogFxRates;
  nowIso: string;
  onOpenDetails: () => void;
  onOpenDuplicates: () => void;
};

/**
 * Mobile card (spec section 15: "Convert table rows into supplier-product
 * cards", not a squeezed table row). Supplier identity, status, and
 * availability all stay visible without scrolling the card sideways, and
 * the touch target is the whole card.
 */
export default function SupplierProductCard({
  product,
  connection,
  rates,
  nowIso,
  onOpenDetails,
  onOpenDuplicates,
}: SupplierProductCardProps) {
  const stockText = STOCK_TEXT[product.stock];
  const phpEstimate = formatPhpEstimate(
    estimatePhpMinor(
      product.supplierCurrency,
      product.supplierPriceMinor,
      rates,
    ),
  );

  return (
    <button
      type="button"
      onClick={onOpenDetails}
      aria-label={`Open details for ${product.title}`}
      className="flex min-h-11 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted"
        >
          <Package className="size-4 text-ink-faint" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {product.normalizedTitle ?? product.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {product.externalProductId} · {product.category}
          </p>
        </div>
        <EvaluationStatusPill status={product.evaluationStatus} />
      </div>

      <SupplierIdentity connection={connection} variant="compact" />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div>
          <p className="font-medium tabular-nums">
            {formatMinorUnits(
              product.supplierPriceMinor,
              product.supplierCurrency,
            )}
          </p>
          {phpEstimate === null ? null : (
            <p className="text-xs text-muted-foreground">
              Estimated {phpEstimate}
            </p>
          )}
        </div>
        <p
          className={
            stockText.tone === 'danger' ? 'text-red-600' : 'text-ink-muted'
          }
        >
          {stockText.label}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Ships from{' '}
          {product.shipsFrom.length === 0 ? '—' : product.shipsFrom.join(', ')}
        </span>
        <EvidenceFreshness
          lastSyncedAt={product.lastSyncedAt}
          isStale={product.isStale}
          nowIso={nowIso}
        />
      </div>

      {product.potentialDuplicateOfIds.length > 0 ? (
        <PotentialDuplicateIndicator
          count={product.potentialDuplicateOfIds.length}
          onOpen={onOpenDuplicates}
        />
      ) : null}
    </button>
  );
}
