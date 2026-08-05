'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { buildHref } from '@/lib/portal/search-params';

export type FilterOption = { value: string; label: string };

type FilterSelectProps = {
  id: string;
  label: string;
  param: string;
  value: string;
  options: FilterOption[];
  /** Value that means "no filter" and is removed from the URL. */
  clearValue?: string;
};

/**
 * One URL-backed filter control. Changing it navigates, so the server renders
 * the filtered list and the choice survives a reload or a shared link.
 */
export default function FilterSelect({
  id,
  label,
  param,
  value,
  options,
  clearValue = 'all',
}: FilterSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const handleChange = useCallback(
    (next: unknown) => {
      if (typeof next !== 'string') {
        return;
      }

      const href = buildHref('/products', searchParams, {
        [param]: next === clearValue ? null : next,
      });

      startTransition(() => router.push(href));
    },
    [clearValue, param, router, searchParams],
  );

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select items={options} value={value} onValueChange={handleChange}>
        <SelectTrigger
          id={id}
          size="default"
          className="h-9 min-w-44 cursor-pointer bg-card"
          data-pending={pending ? '' : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
