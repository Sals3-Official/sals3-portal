'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { buildHref } from '@/lib/portal/search-params';

type OrdersSortSelectProps = {
  options: { key: string; label: string }[];
  active: string;
  defaultKey: string;
};

/**
 * Sort control.
 *
 * The one client component in the filter chrome, and only because a `<select>`
 * has no way to navigate on change without script. Everything else here - lane
 * tabs, chips, search - stays a link or a native form.
 *
 * It still writes to the URL rather than holding state, so sorting remains
 * shareable and survives the back button like every other part of this view.
 * The default value is removed from the query string rather than written out,
 * matching `buildQueryString`'s own convention.
 */
export default function OrdersSortSelect({
  options,
  active,
  defaultKey,
}: OrdersSortSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // One option is not a choice. A `<select>` offering it still invites a click
  // that can change nothing, so the ordering is stated instead of offered -
  // the seller keeps the information and loses the dead control. This is the
  // live shape today: `ship-by-asc` was removed because no dropship parcel
  // carries a despatch promise, leaving order date as the only real key.
  if (options.length <= 1) {
    return (
      <p className="text-[12.5px] text-ink-subtle">
        Sorted by {options[0]?.label ?? 'order date'}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="text-[12.5px] text-ink-subtle">
        Sort
      </span>
      <select
        aria-label="Sort orders"
        value={active}
        onChange={(event) => {
          const next = event.target.value;

          router.push(
            buildHref('/orders', searchParams, {
              sort: next === defaultKey ? null : next,
            }),
          );
        }}
        className="h-8 cursor-pointer rounded-md border border-border bg-card px-2.5 text-[12.5px] text-ink"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
