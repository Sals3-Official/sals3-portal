'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LISTINGS_PATH,
  LISTINGS_SEARCH_FIELD_LABELS,
  type ListingsQuery,
  type ListingsSearchField,
} from '@/lib/portal/listings-params';
import { buildHref } from '@/lib/portal/search-params';

type CatalogueSearchInputProps = {
  query: ListingsQuery;
  current: Record<string, string>;
};

const DEBOUNCE_MS = 300;

const PLACEHOLDER: Record<ListingsSearchField, string> = {
  NAME: 'Search product name',
  SALS3_PRODUCT_ID: 'Search Sals3 Product ID',
  SELLER_SKU: 'Search Seller SKU',
  SUPPLIER_REFERENCE: 'Search CJ product ID',
};

/**
 * Field picker joined to a search box, submitting to the URL.
 *
 * The field is part of the query rather than a client-side hint because the
 * server decides which column the term is matched against - a Seller SKU search
 * is an `EXISTS` over variants, not a filter over what was already fetched.
 */
export default function CatalogueSearchInput({
  query,
  current,
}: CatalogueSearchInputProps) {
  const router = useRouter();
  const [term, setTerm] = useState(query.q);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (term === query.q) return undefined;

    const timer = setTimeout(() => {
      const href = buildHref(LISTINGS_PATH, current, {
        q: term.trim() === '' ? null : term.trim(),
      });

      startTransition(() => router.push(href));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, query.q, current, router]);

  return (
    <div className="flex min-w-0 flex-1 items-stretch">
      <Select
        items={LISTINGS_SEARCH_FIELD_LABELS}
        value={query.field}
        onValueChange={(value) =>
          router.push(
            buildHref(LISTINGS_PATH, current, { field: String(value) }),
          )
        }
      >
        <SelectTrigger className="w-44 rounded-r-none bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(LISTINGS_SEARCH_FIELD_LABELS).map(
            ([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      <div className="relative min-w-0 flex-1">
        <Label htmlFor="catalogue-search" className="sr-only">
          {LISTINGS_SEARCH_FIELD_LABELS[query.field]}
        </Label>
        <Input
          id="catalogue-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={PLACEHOLDER[query.field]}
          aria-busy={pending}
          className="h-9 rounded-l-none border-l-0 bg-card pr-8"
        />
        <Search
          aria-hidden="true"
          className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}
