import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Options a seller can actually tell apart at a glance on one screen. */
export const CATALOGUE_PAGE_SIZE_OPTIONS = [12, 25, 50, 100] as const;

export type CataloguePageSize = (typeof CATALOGUE_PAGE_SIZE_OPTIONS)[number];

type CatalogueProductPaginationProps = {
  page: number;
  totalPages: number;
  total: number;
  pageSize: CataloguePageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: CataloguePageSize) => void;
};

const BUTTON_CLASSES =
  'grid size-8 shrink-0 place-items-center rounded-md border border-border bg-card transition-colors duration-150 hover:bg-accent disabled:pointer-events-none disabled:opacity-50';

/**
 * Previous/Next plus a rows-per-page choice for the Product Catalogue table,
 * matching the visual shape of `PipelinePagination` (the Candidate Pipeline's
 * own pager) for the arrows, with a page-size `Select` added beside them
 * (owner request 2026-09-01 — a fixed 25 gave no way to see more or fewer
 * rows at once).
 *
 * Plain buttons and local state, not `PipelinePagination`'s `Link`s over URL
 * query params: this screen's rows are already loaded and filtered entirely
 * in the browser (see `ProductCatalogueWorkspace`'s own doc comment on why
 * paging is a slice here, not a server round trip), so there is no server
 * page to navigate to and no URL position worth making shareable.
 */
export default function CatalogueProductPagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: CatalogueProductPaginationProps) {
  return (
    <nav
      aria-label="Product Catalogue pages"
      className="flex flex-wrap items-center justify-between gap-3 py-1"
    >
      <p className="text-sm text-muted-foreground">
        {total.toLocaleString()} {total === 1 ? 'product' : 'products'}
      </p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className={BUTTON_CLASSES}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <span className="min-w-[4.5rem] text-center text-sm tabular-nums text-muted-foreground">
            {page.toLocaleString()} / {totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className={BUTTON_CLASSES}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>

        <Select
          value={String(pageSize)}
          onValueChange={(next) =>
            onPageSizeChange(Number(next) as CataloguePageSize)
          }
        >
          <SelectTrigger aria-label="Rows per page" className="h-8 bg-card">
            <SelectValue>{pageSize} / page</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CATALOGUE_PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </nav>
  );
}
