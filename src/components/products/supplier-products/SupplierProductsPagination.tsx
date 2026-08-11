import Link from 'next/link';
import { buildHref } from '@/lib/portal/search-params';
import { cn } from '@/lib/utils';

type SupplierProductsPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  currentParams: Record<string, string>;
};

/**
 * Page controls for the local catalogue read. Plain links, so paging is a
 * Server Component re-render against the Sals3 database - never a supplier
 * request, and never a client-side slice of an already-fetched page.
 */
export default function SupplierProductsPagination({
  page,
  totalPages,
  total,
  pageSize,
  currentParams,
}: SupplierProductsPaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const linkClass =
    'rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

  return (
    <nav
      aria-label="Supplier products pages"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-ink-muted" aria-live="polite">
        {total === 0
          ? 'No products match these filters'
          : `Showing ${first}–${last} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={buildHref('/products', currentParams, {
              page: page - 1,
              source: null,
            })}
            className={linkClass}
            rel="prev"
          >
            Previous
          </Link>
        ) : (
          <span className={cn(linkClass, 'opacity-50')} aria-disabled="true">
            Previous
          </span>
        )}
        <span className="text-sm tabular-nums text-ink-muted">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={buildHref('/products', currentParams, {
              page: page + 1,
              source: null,
            })}
            className={linkClass}
            rel="next"
          >
            Next
          </Link>
        ) : (
          <span className={cn(linkClass, 'opacity-50')} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
