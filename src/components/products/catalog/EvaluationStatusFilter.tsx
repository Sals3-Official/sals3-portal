'use client';

import { ListFilter } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildHref } from '@/lib/portal/search-params';
import { presentEvaluationStatus } from '@/lib/products/catalog-presentation';
import {
  NOT_QUEUED_SENTINEL,
  type AllSupplierProductsQuery,
} from '@/lib/products/catalog-filters';
import type { EvaluationStatus } from '@/lib/products/catalog-types';

type EvaluationStatusFilterProps = {
  basePath: string;
  value: string;
};

const OPTIONS: Array<{ value: EvaluationStatus | typeof NOT_QUEUED_SENTINEL }> =
  [
    { value: NOT_QUEUED_SENTINEL },
    { value: 'QUEUED' },
    { value: 'EVALUATING' },
    { value: 'PASS' },
    { value: 'PASS_WITH_ATTENTION' },
    { value: 'TEMPORARILY_INELIGIBLE' },
    { value: 'BLOCKED' },
    { value: 'EVALUATION_FAILED' },
  ];

function labelFor(
  value: EvaluationStatus | typeof NOT_QUEUED_SENTINEL,
): string {
  return value === NOT_QUEUED_SENTINEL
    ? presentEvaluationStatus(null).label
    : presentEvaluationStatus(value).label;
}

/**
 * Multi-select evaluation-status filter (spec section 6, control 3). Each
 * option's label is the same word the row badge already uses - the system's
 * decision reads identically wherever it appears, per this redesign's rule
 * of reusing pipeline vocabulary rather than inventing new copy.
 */
export default function EvaluationStatusFilter({
  basePath,
  value,
}: EvaluationStatusFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = new Set(value === '' ? [] : value.split(','));

  function toggle(optionValue: string, checked: boolean) {
    const next = new Set(selected);

    if (checked) {
      next.add(optionValue);
    } else {
      next.delete(optionValue);
    }

    const patch: Partial<
      Record<keyof AllSupplierProductsQuery, string | null>
    > = {
      status: next.size === 0 ? null : [...next].join(','),
      page: null,
    };

    router.push(buildHref(basePath, searchParams, patch));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" className="h-9 bg-card">
            <ListFilter aria-hidden="true" className="size-4" />
            Evaluation status
            {selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Evaluation status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.has(option.value)}
            onCheckedChange={(checked) => toggle(option.value, checked)}
            onClick={(event) => event.preventDefault()}
          >
            {labelFor(option.value)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
