'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type Sals3CategoryOption = { code: string; path: string };

type Sals3CategoryPickerProps = {
  options: Sals3CategoryOption[];
  /** The currently resolved category, if any — from the read-model, never invented client-side. */
  currentPath: string | null;
  onSave: (
    code: string,
    reason: string,
  ) => Promise<
    { ok: true; categoryPath: string } | { ok: false; message: string }
  >;
};

const MAX_RESULTS = 20;

/**
 * Search-first, not a flat dropdown: 5,595 rows across 21 departments and up
 * to 5 levels each makes a plain `<select>` unusable. Filters the whole tree
 * by substring match on its denormalized `path` (e.g. "Jackets" matches
 * "Apparel & Accessories > Clothing > Outerwear > Coats & Jackets" at any
 * depth).
 *
 * A picked category is not saved until "Save category" is pressed with a
 * reason — the reason is the seller's own record of why, not a governance
 * review artifact: this changes only the one product open in this editor
 * (owner decision 2026-08-15 — see `decideProductSals3Category`'s doc
 * comment), never another product or another seller's catalogue.
 */
export default function Sals3CategoryPicker({
  options,
  currentPath,
  onSave,
}: Sals3CategoryPickerProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Sals3CategoryOption | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'error'; message: string }
  >({ state: 'idle' });
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();

    if (trimmed === '') return [];

    return options
      .filter((option) => option.path.toLowerCase().includes(trimmed))
      .slice(0, MAX_RESULTS);
  }, [options, query]);

  const canSave = selected !== null && reason.trim().length >= 8;

  const handleSave = useCallback(async () => {
    if (selected === null) return;

    setStatus({ state: 'saving' });

    const result = await onSave(selected.code, reason.trim());

    if (result.ok) {
      setSavedPath(result.categoryPath);
      setStatus({ state: 'idle' });
      setSelected(null);
      setReason('');
      setQuery('');
    } else {
      setStatus({ state: 'error', message: result.message });
    }
  }, [onSave, reason, selected]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor="editor-sals3-category-v1">
          Sals3 category (leaf, affects pricing and storefront)
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Current: {savedPath ?? currentPath ?? 'Not yet decided'}
      </p>

      {selected === null ? (
        <>
          <Input
            id="editor-sals3-category-v1"
            type="search"
            placeholder="Search the Sals3 v1 taxonomy, e.g. Jackets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.trim() === '' ? null : (
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-border">
              {matches.length === 0 ? (
                <li className="px-2.5 py-2 text-sm text-muted-foreground">
                  No category matches &quot;{query}&quot;.
                </li>
              ) : (
                matches.map((option) => (
                  <li key={option.code}>
                    <button
                      type="button"
                      className="block w-full px-2.5 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setSelected(option);
                        setQuery('');
                      }}
                    >
                      {option.path}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-input px-2.5 py-1.5 text-sm">
            <span>{selected.path}</span>
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => setSelected(null)}
            >
              Change
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="editor-sals3-category-reason">Reason</Label>
            <Input
              id="editor-sals3-category-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this category (at least 8 characters)"
              aria-describedby="editor-sals3-category-reason-help"
            />
            {reason.trim().length >= 8 ? null : (
              <p
                id="editor-sals3-category-reason-help"
                className="text-xs text-muted-foreground"
              >
                {8 - reason.trim().length} more character
                {8 - reason.trim().length === 1 ? '' : 's'} needed.
              </p>
            )}
          </div>
          {status.state === 'error' ? (
            <p role="alert" className="text-xs font-medium text-red-600">
              {status.message}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="self-start"
            disabled={!canSave || status.state === 'saving'}
            onClick={handleSave}
          >
            {status.state === 'saving' ? 'Saving…' : 'Save category'}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Applies to this product only. Choose carefully — the wrong category can
        hurt how buyers find and trust this listing.
      </p>
    </div>
  );
}
