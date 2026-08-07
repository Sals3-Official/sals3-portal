import { AlertTriangle } from 'lucide-react';
import { formatRelativeTime } from '@/lib/products/catalog-presentation';
import type { SupplierFetchFailure } from '@/lib/products/catalog-types';

type FailedSupplier = SupplierFetchFailure & { providerDisplayName: string };

type SupplierPartialFailureBannerProps = {
  failedSuppliers: FailedSupplier[];
  healthySupplierNames: string[];
  nowIso: string;
};

/**
 * "One failed supplier must not take down the entire catalog" (spec section
 * 10). Names exactly which provider failed and when it last synced
 * successfully, and states what is still visible - never a full-page error
 * unless every selected source is unavailable (that case is
 * `SupplierCatalogEmptyState`, not this banner).
 */
export default function SupplierPartialFailureBanner({
  failedSuppliers,
  healthySupplierNames,
  nowIso,
}: SupplierPartialFailureBannerProps) {
  if (failedSuppliers.length === 0) return null;

  return (
    <div
      role="alert"
      className="flex animate-in items-start gap-2 fade-in slide-in-from-top-1 rounded-md border border-amber-600/30 bg-warning-surface px-3 py-2 text-sm text-amber-600 duration-300"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        {failedSuppliers
          .map(
            (failed) =>
              `${failed.providerDisplayName} products could not be refreshed (last synced ${formatRelativeTime(failed.lastSuccessfulSyncAt, nowIso)})`,
          )
          .join('; ')}
        .{' '}
        {healthySupplierNames.length > 0
          ? `Showing available results from ${healthySupplierNames.join(', ')}.`
          : 'No other connected supplier has usable results right now.'}
      </p>
    </div>
  );
}
