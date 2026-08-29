import Image from 'next/image';
import StarRating from '@/components/reviews/StarRating';
import { formatMinorUnits } from '@/lib/products/catalog-presentation';
import type { SellerSoldRow } from '@/modules/orders/seller-sold-read';

type SoldRowProps = {
  row: SellerSoldRow;
  rank: number;
  /** Units of the best-selling row, for the in-cell bar. */
  leaderUnits: number;
};

export const SOLD_GRID =
  'grid grid-cols-[2rem_1fr] gap-x-3 gap-y-2 md:grid-cols-[2.5rem_1fr_6.75rem_5.5rem_7.75rem_9.25rem] md:gap-4';

/**
 * One product's sales.
 *
 * The bar inside the units cell is scaled to the leading row, not to the
 * account total — here it is a comparison between the rows on screen, and it
 * carries no percentage label to contradict. The band above does the opposite,
 * for the opposite reason.
 */
export default function SoldRow({ row, rank, leaderUnits }: SoldRowProps) {
  const share = leaderUnits === 0 ? 0 : (row.units / leaderUnits) * 100;

  return (
    <div className={`${SOLD_GRID} items-center border-b border-border p-4`}>
      <span
        className={`font-display text-[0.9375rem] font-semibold tabular-nums ${
          rank === 1 ? 'text-brand-600' : 'text-ink-faint'
        }`}
      >
        {rank}
      </span>

      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
          {row.imageUrl === null ? null : (
            // The address frozen onto the order line, same as `ReviewRow`: it
            // always resolves without a media join, and it is what the buyer
            // was actually shown.
            <Image
              src={row.imageUrl}
              alt=""
              width={44}
              height={44}
              sizes="44px"
              className="size-full object-cover"
            />
          )}
        </span>
        <span className="min-w-0 text-[0.8125rem] leading-snug font-semibold text-ink">
          {row.title}
        </span>
      </div>

      <div className="col-start-2 flex flex-col gap-1 md:col-start-auto">
        <span className="text-sm font-semibold text-ink tabular-nums">
          <span className="text-xs font-normal text-ink-subtle md:hidden">
            Units sold{' '}
          </span>
          {row.units.toLocaleString('en-US')}
        </span>
        <span className="hidden h-1 overflow-hidden rounded-full bg-muted md:block">
          <span
            className={`block h-full rounded-full ${rank === 1 ? 'bg-brand-600' : 'bg-border-strong'}`}
            style={{ width: `${share.toFixed(1)}%` }}
          />
        </span>
      </div>

      <span className="col-start-2 text-[0.8125rem] text-ink-muted tabular-nums md:col-start-auto">
        <span className="text-xs text-ink-subtle md:hidden">Orders </span>
        {row.orders.toLocaleString('en-US')}
      </span>

      <span className="col-start-2 text-[0.8125rem] text-ink-muted tabular-nums md:col-start-auto">
        <span className="text-xs text-ink-subtle md:hidden">Revenue </span>
        {formatMinorUnits(row.revenueMinor, row.currency)}
      </span>

      <div className="col-start-2 md:col-start-auto">
        {row.averageRating === null ? (
          <span className="inline-flex h-[1.375rem] items-center rounded border border-warning-border bg-warning-surface px-2 text-[0.6875rem] font-semibold text-ink">
            No reviews yet
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <StarRating
              rating={Math.round(row.averageRating)}
              size="sm"
              label={`${row.averageRating.toFixed(1)} out of 5`}
            />
            <span className="text-[0.8125rem] font-semibold text-ink tabular-nums">
              {row.averageRating.toFixed(1)}
            </span>
            <span className="text-xs text-ink-subtle tabular-nums">
              ({row.reviewCount})
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
