import { Package } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  estimatePhpMinor,
  formatMinorUnits,
  formatPhpEstimate,
  STOCK_TEXT,
} from '@/lib/products/catalog-presentation';
import {
  listingStateOf,
  type CatalogFxRates,
  type SupplierConnectionFixture,
  type SupplierProductFixture,
} from '@/lib/products/catalog-types';
import EvaluationStatusPill from './EvaluationStatusPill';
import EvidenceFreshness from './EvidenceFreshness';
import PotentialDuplicateIndicator from './PotentialDuplicateIndicator';
import SupplierIdentity from './SupplierIdentity';

type SupplierProductRowProps = {
  product: SupplierProductFixture;
  connection: SupplierConnectionFixture;
  rates: CatalogFxRates;
  nowIso: string;
  onOpenDetails: () => void;
  onOpenDuplicates: () => void;
};

function listingCellText(
  existingListingsCount: number,
  listingState: ReturnType<typeof listingStateOf>,
): string {
  if (listingState === 'NOT_LISTED') return 'Not listed';
  if (listingState === 'HAS_LISTING') return '1 listing';

  return `${existingListingsCount} listings`;
}

function formatFxAge(fxIso: string, nowIso: string): string {
  const diffMinutes = Math.max(
    0,
    Math.round(
      (new Date(nowIso).getTime() - new Date(fxIso).getTime()) / 60_000,
    ),
  );

  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  return `${Math.round(diffMinutes / 60)}h ago`;
}

/**
 * One row of the desktop table (spec section 7's column list). The whole row
 * opens the read-only details drawer on click - there is no per-row action
 * button, matching the pipeline's "the system decides, the seller reviews"
 * rule already established on the real Product Sourcing screens.
 */
export default function SupplierProductRow({
  product,
  connection,
  rates,
  nowIso,
  onOpenDetails,
  onOpenDuplicates,
}: SupplierProductRowProps) {
  const stockText = STOCK_TEXT[product.stock];
  const rate = rates[product.supplierCurrency];
  const phpEstimate = formatPhpEstimate(
    estimatePhpMinor(
      product.supplierCurrency,
      product.supplierPriceMinor,
      rates,
    ),
  );
  const listingState = listingStateOf(product.existingListingsCount);

  return (
    <TableRow
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${product.title}`}
      onClick={onOpenDetails}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      className="cursor-pointer"
    >
      <TableCell className="max-w-72 p-2">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted"
          >
            <Package className="size-4 text-ink-faint" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium" title={product.title}>
              {product.normalizedTitle ?? product.title}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {product.externalProductId} · {product.category}
            </p>
            {product.potentialDuplicateOfIds.length > 0 ? (
              <div className="mt-1">
                <PotentialDuplicateIndicator
                  count={product.potentialDuplicateOfIds.length}
                  onOpen={onOpenDuplicates}
                />
              </div>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="p-2">
        <SupplierIdentity connection={connection} variant="compact" />
      </TableCell>
      <TableCell className="p-2 tabular-nums">
        <p>
          {formatMinorUnits(
            product.supplierPriceMinor,
            product.supplierCurrency,
          )}
        </p>
        {phpEstimate === null || rate === undefined ? null : (
          <p className="text-xs text-muted-foreground">
            Estimated {phpEstimate} · FX updated{' '}
            {formatFxAge(rate.fetchedAt, nowIso)}
            {rate.stale ? ' (stale fallback)' : ''}
          </p>
        )}
      </TableCell>
      <TableCell className="p-2">
        <p className={stockText.tone === 'danger' ? 'text-red-600' : undefined}>
          {stockText.label}
        </p>
        {product.availableVariantCount !== null &&
        product.totalVariantCount !== null ? (
          <p className="text-xs text-muted-foreground">
            {product.availableVariantCount}/{product.totalVariantCount} variants
          </p>
        ) : null}
      </TableCell>
      <TableCell className="p-2 text-sm text-ink-muted">
        {product.shipsFrom.length === 0 ? '—' : product.shipsFrom.join(', ')}
      </TableCell>
      <TableCell
        className={
          listingState === 'NOT_LISTED'
            ? 'p-2 text-sm text-muted-foreground tabular-nums'
            : 'p-2 text-sm tabular-nums'
        }
      >
        {listingCellText(product.existingListingsCount, listingState)}
      </TableCell>
      <TableCell className="p-2">
        <EvaluationStatusPill status={product.evaluationStatus} />
      </TableCell>
      <TableCell className="p-2">
        <EvidenceFreshness
          lastSyncedAt={product.lastSyncedAt}
          isStale={product.isStale}
          nowIso={nowIso}
        />
      </TableCell>
    </TableRow>
  );
}
