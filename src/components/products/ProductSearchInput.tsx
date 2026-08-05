'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildHref } from '@/lib/portal/search-params';

type ProductSearchInputProps = {
  value: string;
};

const DEBOUNCE_MS = 300;

/**
 * Search box for name, SKU, and barcode. The typed value is debounced before
 * it becomes a navigation, so one search does not fire a request per keystroke.
 */
export default function ProductSearchInput({ value }: ProductSearchInputProps) {
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
        q: term.trim() === '' ? null : term.trim(),
      });

      startTransition(() => router.push(href));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, value, router, searchParams]);

  return (
    <div className="flex w-full flex-col gap-1 md:w-auto md:flex-1">
      <Label htmlFor="product-search" className="text-xs text-muted-foreground">
        Search
      </Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="product-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Product name, SKU, or barcode"
          aria-busy={pending}
          className="h-9 bg-card pl-8"
        />
      </div>
    </div>
  );
}
