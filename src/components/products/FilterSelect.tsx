'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { buildHref } from '@/lib/portal/search-params';

export type FilterOption = { value: string; label: string };

type FilterSelectProps = {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  /** Route the change navigates to. */
  path: string;
  /** URL parameter this select owns. */
  param: string;
  /** Value that means "no filter" and is therefore removed from the URL. */
  clearedValue: string;
  /**
   * Other parameters a change must drop. `page` is always dropped and is not
   * listed here: changing a filter changes the result set, and keeping page 7
   * across it lands the seller on an empty page they read as "no matches".
   */
  alsoClears?: string[];
  className?: string;
};

/**
 * One filter in a table's filter bar, as a native `<select>`.
 *
 * A native control on purpose: it is keyboard- and screen-reader-operable
 * everywhere without a custom listbox, and a category list can hold a few
 * hundred options that a custom popover would render far less efficiently. It
 * is also the only shape that behaves on a phone, where a long row of chips
 * wraps into three lines and pushes the table below the fold.
 *
 * Changing a filter navigates to a new URL the Server Component answers, which
 * is what keeps every filtered view shareable and the filtering itself in SQL
 * rather than over the rows already in hand.
 *
 * Generic over the route because two screens now need exactly this: All
 * Supplier Products and the sourcing pipeline. One home, so a fix to the
 * keyboard or the pending state reaches both.
 */
export default function FilterSelect({
  id,
  label,
  value,
  options,
  path,
  param,
  clearedValue,
  alsoClears = [],
  className,
}: FilterSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        aria-busy={pending}
        onChange={(event) => {
          const next = event.target.value;
          const href = buildHref(path, searchParams, {
            [param]: next === clearedValue ? null : next,
            page: null,
            ...Object.fromEntries(alsoClears.map((key) => [key, null])),
          });

          startTransition(() => router.push(href));
        }}
        className="h-9 w-full truncate rounded-md border border-border bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
