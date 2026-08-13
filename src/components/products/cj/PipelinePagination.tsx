import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { buildHref } from '@/lib/portal/search-params';

type PipelinePaginationProps = {
  /** The list route the page links target. Defaults to the pipeline. */
  path?: string;
  page: number;
  totalPages: number;
  total: number;
  /** `tab` and `q` as currently in the URL - patching only `page` keeps both. */
  currentParams: Record<string, string>;
};

const LINK_CLASSES =
  'flex min-h-11 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors duration-150 hover:bg-accent';

/**
 * Previous and next links for one pipeline tab, matching the supplier
 * catalogue's pagination (`CjPagination`).
 *
 * No numbered page list on purpose: a blocked tab can hold tens of thousands
 * of candidates, which is hundreds of pages - a wall of links nobody clicks.
 * The page number stays in the URL, so a position is shareable and the back
 * button behaves.
 */
export default function PipelinePagination({
  path = '/products/pipeline',
  page,
  totalPages,
  total,
  currentParams,
}: PipelinePaginationProps) {
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      aria-label="Candidate pipeline pages"
      className="flex flex-wrap items-center justify-between gap-3 py-3"
    >
      <p className="text-sm text-muted-foreground">
        Page {page.toLocaleString()} of {totalPages.toLocaleString()} ·{' '}
        {total.toLocaleString()} {total === 1 ? 'candidate' : 'candidates'}
      </p>
      <div className="flex items-center gap-2">
        {hasPrevious ? (
          <Link
            href={buildHref(path, currentParams, {
              page: page - 1,
            })}
            className={LINK_CLASSES}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </Link>
        ) : null}
        {hasNext ? (
          <Link
            href={buildHref(path, currentParams, {
              page: page + 1,
            })}
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
