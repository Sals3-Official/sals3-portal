'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { MAX_BULK_DRAFT_CANDIDATES } from '@/modules/catalog/products/contracts';

/**
 * Selection state for one page of pipeline candidates.
 *
 * Client context wrapped AROUND the server-rendered table, so no table
 * component gives up being a Server Component: only the checkbox cells, the
 * header checkbox, and the action button subscribe. The provider unmounts on
 * every tab/page navigation (a different server tree), which is exactly the
 * reset behaviour a page-scoped selection wants.
 *
 * The cap equals `MAX_BULK_DRAFT_CANDIDATES` (100), which equals
 * `PIPELINE_PAGE_SIZE` - so "select all on this page" and "the largest legal
 * batch" are the same number and cannot drift apart. The cap toast is only
 * reachable if the page size ever grows past the batch cap.
 */

type PipelineSelection = {
  selected: ReadonlySet<string>;
  toggle: (candidateId: string) => void;
  setMany: (candidateIds: string[], checked: boolean) => void;
  remove: (candidateIds: string[]) => void;
  clear: () => void;
};

const SelectionContext = createContext<PipelineSelection | null>(null);

export function usePipelineSelection(): PipelineSelection {
  const context = useContext(SelectionContext);

  if (context === null) {
    throw new Error(
      'usePipelineSelection must be used inside PipelineSelectionProvider.',
    );
  }

  return context;
}

function capped(next: Set<string>): Set<string> {
  if (next.size <= MAX_BULK_DRAFT_CANDIDATES) return next;

  toast(`You can add up to ${MAX_BULK_DRAFT_CANDIDATES} products at once.`);

  return new Set([...next].slice(0, MAX_BULK_DRAFT_CANDIDATES));
}

export default function PipelineSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((candidateId: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);

      return capped(next);
    });
  }, []);

  const setMany = useCallback((candidateIds: string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);

      candidateIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));

      return capped(next);
    });
  }, []);

  const remove = useCallback((candidateIds: string[]) => {
    setSelected((current) => {
      const next = new Set(current);

      candidateIds.forEach((id) => next.delete(id));

      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, toggle, setMany, remove, clear }),
    [selected, toggle, setMany, remove, clear],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}
