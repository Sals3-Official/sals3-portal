import Link from 'next/link';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  estimatePhpMinor,
  explainReasonCode,
  formatMinorUnits,
  formatPhpEstimate,
  presentEvaluationStatus,
  STOCK_TEXT,
} from '@/lib/products/catalog-presentation';
import {
  listingStateOf,
  type CatalogFxRates,
  type SupplierConnectionFixture,
  type SupplierProductFixture,
} from '@/lib/products/catalog-types';
import EvaluationStatusPill from './EvaluationStatusPill';
import SupplierIdentity from './SupplierIdentity';

type SupplierProductDetailsDrawerProps = {
  product: SupplierProductFixture | null;
  connection: SupplierConnectionFixture | null;
  rates: CatalogFxRates;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Read-only quick-details drawer (spec section 9). Every section here is
 * evidence the pipeline already captured - nothing is editable, and there is
 * deliberately no "Check for Sals3" action. Links out to the relevant
 * Product Sourcing screen instead of duplicating that screen's content.
 */
export default function SupplierProductDetailsDrawer({
  product,
  connection,
  rates,
  open,
  onOpenChange,
}: SupplierProductDetailsDrawerProps) {
  if (product === null || connection === null) {
    return <Sheet open={open} onOpenChange={onOpenChange} />;
  }

  const presentation = presentEvaluationStatus(product.evaluationStatus);
  const listingState = listingStateOf(product.existingListingsCount);
  const phpEstimate = formatPhpEstimate(
    estimatePhpMinor(
      product.supplierCurrency,
      product.supplierPriceMinor,
      rates,
    ),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        aria-label={`Details for ${product.title}`}
        className="overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>{product.normalizedTitle ?? product.title}</SheetTitle>
          <SheetDescription>{product.title}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6 text-sm">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
              Supplier source
            </h3>
            <SupplierIdentity connection={connection} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ink-muted">
              <dt>Supplier product ID</dt>
              <dd className="font-mono text-xs">{product.externalProductId}</dd>
              <dt>Category</dt>
              <dd>{product.category}</dd>
              {product.sourceUrl === null ? null : (
                <>
                  <dt>Supplier URL</dt>
                  <dd className="font-mono text-xs break-all">
                    {product.sourceUrl}
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
              Commercial evidence
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ink-muted">
              <dt>Supplier price</dt>
              <dd>
                {formatMinorUnits(
                  product.supplierPriceMinor,
                  product.supplierCurrency,
                )}
                {product.supplierPriceMaxMinor === null
                  ? ''
                  : ` – ${formatMinorUnits(product.supplierPriceMaxMinor, product.supplierCurrency)}`}
              </dd>
              {phpEstimate === null ? null : (
                <>
                  <dt>Estimated PHP</dt>
                  <dd>
                    {phpEstimate} - not the final landed cost, and never used to
                    sort against other currencies.
                  </dd>
                </>
              )}
              <dt>Variants</dt>
              <dd>
                {product.availableVariantCount ?? '—'} of{' '}
                {product.totalVariantCount ?? '—'} available ·{' '}
                {STOCK_TEXT[product.stock].label}
              </dd>
              <dt>Ships from</dt>
              <dd>
                {product.shipsFrom.length === 0
                  ? 'No shipping route currently reported'
                  : product.shipsFrom.join(', ')}
              </dd>
              <dt>Last supplier update</dt>
              <dd>{new Date(product.lastSupplierUpdateAt).toLocaleString()}</dd>
              <dt>Last synced</dt>
              <dd>
                {new Date(product.lastSyncedAt).toLocaleString()}
                {product.isStale ? ' (may be stale)' : ''}
              </dd>
            </dl>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
              Product-quality evidence
            </h3>
            {product.mediaRightsWarning ? (
              <p role="alert" className="text-amber-600">
                Media rights for this listing have not been confirmed as safe to
                reuse.
              </p>
            ) : null}
            {product.restrictedCategoryWarning ? (
              <p role="alert" className="text-red-600">
                This product matches a restricted or prohibited-brand keyword.
              </p>
            ) : null}
            {!product.mediaRightsWarning &&
            !product.restrictedCategoryWarning ? (
              <p className="text-ink-muted">No quality warnings recorded.</p>
            ) : null}
            <p className="text-xs text-ink-faint">
              No rating or sold-count figure is shown: the connected provider
              does not return one this pipeline trusts.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
              Evaluation
            </h3>
            <div className="flex items-center gap-2">
              <EvaluationStatusPill status={product.evaluationStatus} />
            </div>
            <p className="text-ink-muted">{presentation.description}</p>
            {product.evaluationReasonCodes.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {product.evaluationReasonCodes.map((code) => (
                  <li key={code}>
                    <span className="font-medium text-foreground">{code}</span>{' '}
                    — {explainReasonCode(code)}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
              Sals3 relationship
            </h3>
            <p className="text-ink-muted">
              {listingState === 'NOT_LISTED'
                ? 'No Sals3 listing uses this supplier product yet.'
                : `${product.existingListingsCount} Sals3 listing${product.existingListingsCount === 1 ? '' : 's'} use this supplier product.`}
            </p>
            <div className="flex flex-wrap gap-3 text-primary">
              {product.evaluationStatus === 'PASS' ? (
                <Link href="/products/pipeline?tab=ready" className="underline">
                  View in Ready
                </Link>
              ) : null}
              {product.evaluationStatus === 'PASS_WITH_ATTENTION' ? (
                <Link
                  href="/products/pipeline?tab=needs-attention"
                  className="underline"
                >
                  View in Needs Attention
                </Link>
              ) : null}
              {product.evaluationStatus === 'BLOCKED' ||
              product.evaluationStatus === 'TEMPORARILY_INELIGIBLE' ? (
                <Link
                  href="/products/pipeline?tab=blocked"
                  className="underline"
                >
                  View blocking reason
                </Link>
              ) : null}
              {product.evaluationStatus === 'EVALUATION_FAILED' ? (
                <Link
                  href="/products/pipeline?tab=exception"
                  className="underline"
                >
                  View in Exception Queue
                </Link>
              ) : null}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
