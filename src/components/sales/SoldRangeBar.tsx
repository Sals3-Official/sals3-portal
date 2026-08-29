import Link from 'next/link';
import {
  SOLD_RANGE_KEYS,
  type SoldRange,
  type SoldRangeKey,
} from '@/lib/portal/review-params';

type SoldRangeBarProps = {
  range: SoldRange;
  /** Query string for the export link, so it mirrors what is on screen. */
  exportQuery: string;
};

const LABELS: Record<SoldRangeKey, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
  all: 'All time',
};

/**
 * The window control, and the export that follows it.
 *
 * Presets are links, not client state — a window is a URL a seller can bookmark
 * or send, the same rule the review filters follow. The custom range is a plain
 * `GET` form for the same reason: it lands on a shareable URL and needs no
 * JavaScript to work.
 *
 * Export is an anchor carrying the identical query, so the file can only ever be
 * the table above it. A button that rebuilt the window from its own state is how
 * an export drifts from the screen it claims to represent.
 */
export default function SoldRangeBar({
  range,
  exportQuery,
}: SoldRangeBarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-subtle">
          Sold between
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {SOLD_RANGE_KEYS.map((key) => {
            const active = range.key === key;

            return (
              <Link
                key={key}
                href={
                  key === 'all'
                    ? '/reviews?view=sold'
                    : `/reviews?view=sold&range=${key}`
                }
                aria-current={active ? 'true' : undefined}
                className={`inline-flex min-h-9 items-center rounded-md border px-3 text-xs font-semibold transition-colors hover:no-underline ${
                  active
                    ? 'border-brand-600 bg-brand-100 text-brand-700'
                    : 'border-border-strong bg-card text-ink-muted hover:text-ink'
                }`}
              >
                {LABELS[key]}
              </Link>
            );
          })}
        </div>
      </div>

      <form
        method="get"
        action="/reviews"
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="view" value="sold" />
        <label
          htmlFor="sold-from"
          className="flex flex-col gap-1 text-xs text-ink-subtle"
        >
          From
          <input
            id="sold-from"
            type="date"
            name="from"
            defaultValue={range.fromInput}
            className="min-h-9 rounded-md border border-border-strong bg-card px-2.5 text-xs text-ink"
          />
        </label>
        <label
          htmlFor="sold-to"
          className="flex flex-col gap-1 text-xs text-ink-subtle"
        >
          To
          <input
            id="sold-to"
            type="date"
            name="to"
            defaultValue={range.toInput}
            className="min-h-9 rounded-md border border-border-strong bg-card px-2.5 text-xs text-ink"
          />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-9 items-center rounded-md bg-brand-600 px-3.5 text-xs font-semibold text-white"
        >
          Apply
        </button>
        <a
          href={`/api/portal/sales/export${exportQuery}`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border-strong bg-card px-3.5 text-xs font-semibold text-ink-muted hover:text-ink hover:no-underline"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 2.6v7.2" />
            <path d="M5.2 7.2L8 10l2.8-2.8" />
            <path d="M2.8 11.4v1.2a.8.8 0 0 0 .8.8h8.8a.8.8 0 0 0 .8-.8v-1.2" />
          </svg>
          Export CSV
        </a>
      </form>
    </div>
  );
}
