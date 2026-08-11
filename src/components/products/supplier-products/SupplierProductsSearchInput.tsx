'use client';

import { Search } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildHref } from '@/lib/portal/search-params';

type SupplierProductsSearchInputProps = {
  /** The committed term the server rendered this page with. */
  value: string;
};

/** Minimum meaningful characters before a database search is submitted. */
const MIN_LENGTH = 2;
const DEBOUNCE_MS = 350;

/** Collapses runs of whitespace so " a  b " and "a b" are one search. */
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Search over this seller's persisted supplier products.
 *
 * Behaviour this component is responsible for, and why:
 *
 * - **No request below two meaningful characters.** The old input searched
 *   after a single character, which submitted a near-useless query on the
 *   first keystroke of every word typed. A single character now leaves the
 *   current scoped result set completely intact and shows helper copy.
 * - **350 ms debounce at two or more characters**, with Enter submitting
 *   immediately once the minimum is met.
 * - **Stale responses cannot replace newer ones.** Each committed term is
 *   recorded in a ref before navigating; a late-arriving render for an older
 *   term is ignored because the effect only ever navigates toward the term
 *   currently typed.
 * - **The input is preserved while a request is pending**, and clearing the
 *   field restores the unfiltered scoped set.
 * - **Page resets to one** on a committed search change, never on a keystroke
 *   that does not change the committed term.
 *
 * The debounce and minimum are a UX and request-volume control only. The
 * database search itself stays parameterized and seller-scoped on the server;
 * nothing here is an authorization boundary, and nothing here filters rows in
 * the browser.
 */
export default function SupplierProductsSearchInput({
  value,
}: SupplierProductsSearchInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(value);
  const [pending, startTransition] = useTransition();
  /** The term this component has already asked the server for. */
  const committedRef = useRef(value);

  // Adopt a server-driven change (back/forward, a quick view switch) without
  // clobbering what the user is mid-way through typing.
  useEffect(() => {
    committedRef.current = value;
  }, [value]);

  const commit = (next: string) => {
    const cleaned = normalize(next);
    const submittable = cleaned.length >= MIN_LENGTH ? cleaned : '';

    if (submittable === committedRef.current) return;

    committedRef.current = submittable;

    const href = buildHref('/products', searchParams, {
      q: submittable === '' ? null : submittable,
      // A committed search change is a new result set, so page one.
      page: null,
      // Close any open source drawer: it belongs to a row that may not be in
      // the new result set.
      source: null,
    });

    startTransition(() => router.push(href));
  };

  useEffect(() => {
    const cleaned = normalize(term);
    const submittable = cleaned.length >= MIN_LENGTH ? cleaned : '';

    if (submittable === committedRef.current) return undefined;

    const timer = setTimeout(() => commit(term), DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `commit` is recreated per render but closes over the same router and
    // params; depending on `term` alone keeps one timer per typed value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, searchParams]);

  const cleaned = normalize(term);
  const belowMinimum = cleaned.length > 0 && cleaned.length < MIN_LENGTH;

  return (
    <div className="flex w-full flex-col gap-1 md:w-80">
      <Label
        htmlFor="supplier-products-search"
        className="text-xs text-muted-foreground"
      >
        Search your supplier products
      </Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="supplier-products-search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;

            event.preventDefault();

            // Enter submits immediately, but only once the minimum is met -
            // otherwise it would bypass the very rule the debounce enforces.
            if (normalize(term).length >= MIN_LENGTH || term === '') {
              commit(term);
            }
          }}
          placeholder="Product name, SKU, or CJ product ID"
          aria-busy={pending}
          aria-describedby="supplier-products-search-hint"
          className="h-9 bg-card pl-8"
        />
      </div>
      <p
        id="supplier-products-search-hint"
        aria-live="polite"
        className="min-h-4 text-xs text-muted-foreground"
      >
        {belowMinimum ? 'Type at least 2 characters to search' : null}
      </p>
    </div>
  );
}
