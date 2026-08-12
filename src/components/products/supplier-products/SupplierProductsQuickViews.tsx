import Link from 'next/link';
import { cn } from '@/lib/utils';
import { buildHref } from '@/lib/portal/search-params';
import {
  QUICK_VIEW_LABELS,
  SUPPLIER_PRODUCTS_QUICK_VIEWS,
  type SupplierProductsQuery,
} from '@/lib/products/supplier-products-params';

type SupplierProductsQuickViewsProps = {
  active: SupplierProductsQuery['view'];
  currentParams: Record<string, string>;
  /** Row count for the attention view, so the label is factual, not decorative. */
  needsAttentionCount: number;
};

/**
 * Saved local quick views, rendered directly under the page title rather than
 * as a new sidebar menu.
 *
 * Every one is a plain link that changes URL parameters the Server Component
 * reads. Switching views re-queries the Sals3 database and makes ZERO
 * supplier requests - which is the whole point of the change that introduced
 * them.
 */
export default function SupplierProductsQuickViews({
  active,
  currentParams,
  needsAttentionCount,
}: SupplierProductsQuickViewsProps) {
  return (
    <nav aria-label="Saved views" className="flex flex-wrap items-center gap-1">
      {SUPPLIER_PRODUCTS_QUICK_VIEWS.map((view) => {
        const isActive = view === active;

        return (
          <Link
            key={view}
            href={buildHref('/products', currentParams, {
              view: view === 'all' ? null : view,
              page: null,
              source: null,
            })}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              isActive
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border text-ink-muted hover:bg-muted',
            )}
          >
            {QUICK_VIEW_LABELS[view]}
            {view === 'needs-attention' && needsAttentionCount > 0 ? (
              <span className="ml-1.5 tabular-nums">
                ({needsAttentionCount})
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
