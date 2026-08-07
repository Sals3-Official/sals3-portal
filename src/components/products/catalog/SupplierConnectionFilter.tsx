'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildHref } from '@/lib/portal/search-params';
import type { SupplierConnectionFixture } from '@/lib/products/catalog-types';

type SupplierConnectionFilterProps = {
  basePath: string;
  connections: SupplierConnectionFixture[];
  value: string;
};

/**
 * Dynamic Supplier filter (spec section 4): options come only from the
 * seller's own usable connections - never a hardcoded provider list - and a
 * seller with exactly one active connection still sees its name (no
 * "All active suppliers" default hidden behind a single real option; the
 * option is simply the only one there, no extra click required).
 */
export default function SupplierConnectionFilter({
  basePath,
  connections,
  value,
}: SupplierConnectionFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        router.push(
          buildHref(basePath, searchParams, {
            supplier: next === 'all' ? null : String(next),
            page: null,
          }),
        );
      }}
    >
      <SelectTrigger aria-label="Supplier" className="h-9 bg-card">
        <SelectValue placeholder="All active suppliers" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All active suppliers</SelectItem>
        {connections.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            {connection.providerDisplayName}
            {connection.status === 'DEGRADED' ? ' (degraded)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
