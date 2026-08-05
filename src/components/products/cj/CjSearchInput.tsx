'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildHref } from '@/lib/portal/search-params';

type CjSearchInputProps = {
  value: string;
};

const DEBOUNCE_MS = 400;

/**
 * Searches the supplier catalogue by English product name.
 *
 * CJ holds over a million products and allows one call per second, so the typed
 * value is debounced and the page resets to 1 on every new search word.
 */
export default function CjSearchInput({ value }: CjSearchInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(value);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (term === value) {
      return undefined;
    }

    const timer = setTimeout(() => {
      const href = buildHref('/products', searchParams, {
        cjSearch: term.trim() === '' ? null : term.trim(),
        cjPage: null,
        // The old two-source URL carried ?source=cj; scrub it from stale links.
        source: null,
      });

      startTransition(() => router.push(href));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, value, router, searchParams]);

  return (
    <div className="flex w-full flex-col gap-1 md:w-80">
      <Label htmlFor="cj-search" className="text-xs text-muted-foreground">
        Search supplier products
      </Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="cj-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="English product name"
          aria-busy={pending}
          className="h-9 bg-card pl-8"
        />
      </div>
    </div>
  );
}
