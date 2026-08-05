import Link from 'next/link';
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
} from '@/lib/products/constants';
import { buildHref } from '@/lib/portal/search-params';
import type { ProductListQuery, ProductStatus } from '@/lib/products/types';

type ProductStatusTabsProps = {
  query: ProductListQuery;
  counts: Record<ProductStatus | 'all', number>;
};

const TABS: Array<{ value: ProductStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  ...PRODUCT_STATUSES.map((status) => ({
    value: status,
    label: PRODUCT_STATUS_LABELS[status],
  })),
];

/**
 * Status tabs. Plain links, not client state: the status lives in the URL, so
 * the server renders the right page and the back button works.
 */
export default function ProductStatusTabs({
  query,
  counts,
}: ProductStatusTabsProps) {
  const current = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );

  return (
    <nav aria-label="Filter products by status">
      <ul className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => {
          const active = query.status === tab.value;

          return (
            <li key={tab.value}>
              <Link
                href={buildHref('/products', current, {
                  status: tab.value === 'all' ? null : tab.value,
                  page: null,
                })}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm transition-colors duration-150 ${
                  active
                    ? 'border-primary font-semibold text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-ink-muted">
                  {counts[tab.value]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
