import Link from 'next/link';
import { cn } from '@/lib/utils';
import { buildHref } from '@/lib/portal/search-params';
import {
  ORDER_FILTERS,
  type OrderFilterKey,
} from '@/lib/seller-center/mock-data/orders';

type OrdersFilterChipsProps = {
  active: OrderFilterKey;
  currentParams: Record<string, string>;
};

/**
 * Filter chips are plain links, not client state - the current filter lives
 * in the URL so the view stays shareable and the back button behaves.
 */
export default function OrdersFilterChips({
  active,
  currentParams,
}: OrdersFilterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ORDER_FILTERS.map((filter) => {
        const isActive = filter.key === active;

        return (
          <Link
            key={filter.key}
            href={buildHref('/orders', currentParams, {
              orderFilter: filter.key === 'ready' ? null : filter.key,
            })}
            className={cn(
              'h-8 cursor-pointer rounded-full border px-3 text-sm leading-8 whitespace-nowrap transition-colors',
              isActive
                ? 'border-sidebar bg-sidebar text-sidebar-foreground'
                : 'border-border bg-card text-ink-muted hover:border-primary hover:text-primary',
            )}
          >
            {filter.label}
          </Link>
        );
      })}
    </div>
  );
}
