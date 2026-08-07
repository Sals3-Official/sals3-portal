'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildHref } from '@/lib/portal/search-params';

type SupplierSearchInputProps = {
  basePath: string;
  value: string;
};

const DEBOUNCE_MS = 400;

/**
 * Searches by product name, supplier product ID, or category (spec section
 * 6, control 1) - provider-neutral, unlike the old `CjSearchInput` this is
 * modelled on. Debounced and resets to page 1 on every new term, matching
 * this app's existing search-input convention.
 */
export default function SupplierSearchInput({
  basePath,
  value,
}: SupplierSearchInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(value);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (term === value) {
      return undefined;
    }

    const timer = setTimeout(() => {
      const href = buildHref(basePath, searchParams, {
        q: term.trim() === '' ? null : term.trim(),
        page: null,
      });

      startTransition(() => router.push(href));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, value, router, searchParams, basePath]);

  return (
    <div className="flex w-full flex-col gap-1 md:w-72">
      <Label htmlFor="supplier-catalog-search" className="sr-only">
        Search supplier products
      </Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="supplier-catalog-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Name, supplier product ID, or category"
          aria-busy={pending}
          className="h-9 bg-card pl-8"
        />
      </div>
    </div>
  );
}
