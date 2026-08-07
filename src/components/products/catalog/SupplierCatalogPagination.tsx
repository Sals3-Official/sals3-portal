import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buildHref } from '@/lib/portal/search-params';

type SupplierCatalogPaginationProps = {
  basePath: string;
  page: number;
  totalPages: number;
  total: number;
  currentParams: Record<string, string>;
};

const LINK_CLASSES =
  'flex min-h-11 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors duration-150 hover:bg-accent';

/** Previous/next only, matching the existing `CjPagination` idiom - generic over any base path. */
export default function SupplierCatalogPagination({
  basePath,
  page,
  totalPages,
  total,
  currentParams,
}: SupplierCatalogPaginationProps) {
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      aria-label="Supplier catalogue pages"
      className="flex flex-wrap items-center justify-between gap-3 py-3"
    >
      <p className="text-sm text-muted-foreground">
        Page {page.toLocaleString()} of {totalPages.toLocaleString()} ·{' '}
        {total.toLocaleString()} results
      </p>
      <div className="flex items-center gap-2">
        {hasPrevious ? (
          <Link
            href={buildHref(basePath, currentParams, { page: page - 1 })}
            className={LINK_CLASSES}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </Link>
        ) : null}
        {hasNext ? (
          <Link
            href={buildHref(basePath, currentParams, { page: page + 1 })}
            className={LINK_CLASSES}
          >
            Next
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
