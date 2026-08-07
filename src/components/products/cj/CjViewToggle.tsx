'use client';

import { LayoutGrid, Rows3 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildHref } from '@/lib/portal/search-params';
import { cn } from '@/lib/utils';

type CjViewToggleProps = {
  value: 'table' | 'grid';
};

const OPTIONS: Array<{
  value: 'table' | 'grid';
  label: string;
  icon: typeof Rows3;
}> = [
  { value: 'table', label: 'Table', icon: Rows3 },
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
];

/**
 * Switches between the dense table and the image-forward grid - same rows,
 * two ways to scan them. Search term is preserved; the page resets to 1,
 * matching this app's existing "any filter change resets the page" rule
 * (`buildQueryString`).
 */
export default function CjViewToggle({ value }: CjViewToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <div
      role="group"
      aria-label="Catalogue view"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              router.push(
                buildHref('/products', searchParams, {
                  view: option.value,
                  cjPage: null,
                }),
              )
            }
            className={cn(
              'flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-ink-muted hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
