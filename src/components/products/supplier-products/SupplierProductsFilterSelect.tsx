'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Label } from '@/components/ui/label';
import { buildHref } from '@/lib/portal/search-params';

export type FilterOption = { value: string; label: string };

type SupplierProductsFilterSelectProps = {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  /** URL parameter this select owns. */
  param: string;
  /** Value that means "no filter" and is therefore removed from the URL. */
  clearedValue: string;
};

/**
 * One filter in the table's top filter bar.
 *
 * A native `<select>` on purpose: it is keyboard- and screen-reader-operable
 * everywhere without a custom listbox, and the category list can hold a few
 * hundred options that a custom popover would render far less efficiently.
 *
 * Changing a filter navigates to a new URL that the Server Component answers
 * from the Sals3 database. It never triggers a supplier call.
 */
export default function SupplierProductsFilterSelect({
  id,
  label,
  value,
  options,
  param,
  clearedValue,
}: SupplierProductsFilterSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        aria-busy={pending}
        onChange={(event) => {
          const next = event.target.value;
          const href = buildHref('/products', searchParams, {
            [param]: next === clearedValue ? null : next,
            page: null,
            source: null,
          });

          startTransition(() => router.push(href));
        }}
        className="h-9 min-w-44 rounded-md border border-border bg-card px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
