'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildHref } from '@/lib/portal/search-params';

type PipelineSearchInputProps = {
  /** The list route the search submits to. Defaults to the pipeline. */
  path?: string;
  value: string;
};

const DEBOUNCE_MS = 300;

/**
 * Filters the active tab's already-fetched rows by name, CJ product id, or
 * SKU. No extra network round trip - `page.tsx` re-filters the same bounded
 * (<=200 row) list it already queried, so this only needs to update `q` in
 * the URL and let the server component re-render.
 */
export default function PipelineSearchInput({
  path = '/products/pipeline',
  value,
}: PipelineSearchInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(value);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (term === value) {
      return undefined;
    }

    const timer = setTimeout(() => {
      const href = buildHref(path, searchParams, {
        q: term.trim() === '' ? null : term.trim(),
      });

      startTransition(() => router.push(href));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, value, router, searchParams, path]);

  return (
    <div className="flex w-full flex-col gap-1 sm:w-72">
      <Label htmlFor="pipeline-search" className="sr-only">
        Search
      </Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="pipeline-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Product name, ID, or SKU"
          aria-busy={pending}
          className="h-9 bg-card pl-8"
        />
      </div>
    </div>
  );
}
