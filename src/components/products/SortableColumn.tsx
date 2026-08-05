'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { buildHref } from '@/lib/portal/search-params';

export type SortableField = 'name' | 'price' | 'stock' | 'updated';

type SortableColumnProps = {
  field: SortableField;
  label: string;
  sort: string;
};

/**
 * Sortable table header. It is a link, not a button: the sort key lives in the
 * URL, so the server does the sorting and the view stays shareable.
 */
export default function SortableColumn({
  field,
  label,
  sort,
}: SortableColumnProps) {
  const searchParams = useSearchParams();
  const active = sort.startsWith(`${field}-`);
  const ascending = sort === `${field}-asc`;
  const next = active && ascending ? `${field}-desc` : `${field}-asc`;
  const activeGlyph = ascending ? ArrowUp : ArrowDown;
  const Glyph = active ? activeGlyph : ArrowUpDown;

  return (
    <Link
      href={buildHref('/products', searchParams, { sort: next })}
      aria-label={`Sort by ${label.toLowerCase()}, ${
        active && ascending ? 'high to low' : 'low to high'
      }`}
      className={`inline-flex min-h-9 items-center gap-1 transition-colors duration-150 hover:text-foreground ${
        active ? 'font-semibold text-foreground' : ''
      }`}
    >
      {label}
      <Glyph aria-hidden="true" className="size-3.5" />
    </Link>
  );
}
