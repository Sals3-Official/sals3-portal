import Link from 'next/link';
import { buildHref } from '@/lib/portal/search-params';
import { buildPageList } from '@/lib/pagination';
import type { ProductListQuery } from '@/lib/products/types';

type ProductsPaginationProps = {
  query: ProductListQuery;
  page: number;
  totalPages: number;
  totalCount: number;
};

const LINK_CLASSES =
  'flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm transition-colors duration-150';

/** Page links. Reuses the storefront's truncated page-range helper. */
export default function ProductsPagination({
  query,
  page,
  totalPages,
  totalCount,
}: ProductsPaginationProps) {
  if (totalPages <= 1) {
    return (
      <p className="px-1 py-3 text-sm text-muted-foreground">
        {totalCount} {totalCount === 1 ? 'product' : 'products'}
      </p>
    );
  }

  const current = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );

  return (
    <nav
      aria-label="Product list pages"
      className="flex flex-wrap items-center justify-between gap-3 py-3"
    >
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages} · {totalCount} products
      </p>
      <ul className="flex flex-wrap items-center gap-1">
        {buildPageList(page, totalPages).map((item) =>
          typeof item === 'number' ? (
            <li key={item}>
              <Link
                href={buildHref('/products', current, { page: item })}
                aria-current={item === page ? 'page' : undefined}
                className={`${LINK_CLASSES} ${
                  item === page
                    ? 'border-primary bg-primary font-semibold text-primary-foreground'
                    : 'border-border bg-card hover:bg-accent'
                }`}
              >
                {item}
              </Link>
            </li>
          ) : (
            <li
              key={`gap-${item.ellipsisAfter}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground"
            >
              …
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
