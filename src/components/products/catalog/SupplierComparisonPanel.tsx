import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  formatMinorUnits,
  STOCK_TEXT,
} from '@/lib/products/catalog-presentation';
import type {
  SupplierConnectionFixture,
  SupplierProductFixture,
} from '@/lib/products/catalog-types';
import EvaluationStatusPill from './EvaluationStatusPill';
import SupplierIdentity from './SupplierIdentity';

type SupplierComparisonPanelProps = {
  candidates: Array<{
    product: SupplierProductFixture;
    connection: SupplierConnectionFixture;
  }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Lightweight cross-supplier comparison (spec section 11). Explicitly
 * "probable, not guaranteed" - this never merges the two rows into one
 * product, and nothing here writes anything; it is a side-by-side read.
 */
export default function SupplierComparisonPanel({
  candidates,
  open,
  onOpenChange,
}: SupplierComparisonPanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Possible duplicate across suppliers</DialogTitle>
          <DialogDescription>
            These look like the same or a similar product from different
            supplier catalogues. This is a probable match, not a guaranteed one
            - nothing is merged automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {candidates.map(({ product, connection }) => (
            <div
              key={product.id}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <SupplierIdentity connection={connection} variant="compact" />
              <p className="text-sm font-medium">
                {product.normalizedTitle ?? product.title}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-muted">
                <dt>Supplier product ID</dt>
                <dd className="font-mono">{product.externalProductId}</dd>
                <dt>Price</dt>
                <dd>
                  {formatMinorUnits(
                    product.supplierPriceMinor,
                    product.supplierCurrency,
                  )}
                </dd>
                <dt>Variants</dt>
                <dd>
                  {product.availableVariantCount ?? '—'}/
                  {product.totalVariantCount ?? '—'} available
                </dd>
                <dt>Stock</dt>
                <dd>{STOCK_TEXT[product.stock].label}</dd>
                <dt>Ships from</dt>
                <dd>
                  {product.shipsFrom.length === 0
                    ? 'No route'
                    : product.shipsFrom.join(', ')}
                </dd>
                <dt>Evaluation</dt>
                <dd>
                  <EvaluationStatusPill status={product.evaluationStatus} />
                </dd>
                <dt>Evidence age</dt>
                <dd>{new Date(product.lastSyncedAt).toLocaleString()}</dd>
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
