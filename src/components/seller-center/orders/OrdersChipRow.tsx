import Link from 'next/link';
import { cn } from '@/lib/utils';

export type FilterChip = {
  key: string;
  label: string;
  count?: number;
};

type OrdersChipRowProps = {
  label: string;
  chips: FilterChip[];
  active: string;
  hrefFor: (key: string) => string;
};

/**
 * A labelled row of filter chips.
 *
 * Rendered only by lanes where the seller actually has a decision to make -
 * *To process* and *Needs attention*. Shopee shows chips on its To Ship tab
 * and none at all on Shipping or Unpaid, and that restraint is worth keeping:
 * a chip row over a list with one possible state is furniture.
 *
 * The chip treatment is `OrdersFilterChips`' treatment, kept identical so the
 * two never drift into looking like different controls.
 */
export default function OrdersChipRow({
  label,
  chips,
  active,
  hrefFor,
}: OrdersChipRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">{label}</span>
      {chips.map((chip) => {
        const isActive = chip.key === active;

        return (
          <Link
            key={chip.key}
            href={hrefFor(chip.key)}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'h-8 cursor-pointer rounded-full border px-3 text-sm leading-8 whitespace-nowrap transition-colors',
              isActive
                ? 'border-sidebar bg-sidebar text-sidebar-foreground'
                : 'border-border bg-card text-ink-muted hover:border-primary hover:text-primary',
            )}
          >
            {chip.label}
            {chip.count === undefined ? null : (
              <span className="ml-1 tabular-nums">({chip.count})</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
