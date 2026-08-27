'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { PricingScope } from '@/modules/pricing/pricing-scope-destinations';
import CategoryMarginNodeRow from './CategoryMarginNodeRow';
import {
  ROW_GRID,
  rowGridStyle,
  type CategoryMarginNodeViewModel,
  type StoreDefaultSummary,
} from './category-margin-model';

const SEARCH_RESULT_CAP = 50;

type CategoryMarginTreeProps = {
  nodes: CategoryMarginNodeViewModel[];
  /** One column each, in the order they are shown — the six, then Global. */
  scopes: PricingScope[];
  /** The store default per scope key — the last fallback in each column. */
  storeDefaults: Record<string, StoreDefaultSummary | null>;
  sellerAccountId: string;
  canManage: boolean;
};

/**
 * The taxonomy as an expandable tree, replacing the old flat L1>L2 group
 * fan-out list. With nearest-ancestor resolution a margin set on a branch
 * covers everything under it, so the UI's job flips from "set 5,595 leaves
 * in bulk" to "see where a rate comes from, and override only where a
 * branch genuinely differs".
 *
 * Client-side filter over the already-fully-loaded node list — no server
 * round trip on keystroke (the same reasoning the group list documented).
 * Search shows matching nodes flat with their full path; clearing the box
 * returns to the tree.
 */
export default function CategoryMarginTree({
  nodes,
  scopes,
  storeDefaults,
  sellerAccountId,
  canManage,
}: CategoryMarginTreeProps) {
  const [query, setQuery] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const nodesByPath = useMemo(
    () => new Map(nodes.map((node) => [node.path, node])),
    [nodes],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<string, CategoryMarginNodeViewModel[]>();

    nodes.forEach((node) => {
      const key = node.parentPath ?? '';
      const siblings = map.get(key);
      if (siblings === undefined) map.set(key, [node]);
      else siblings.push(node);
    });

    map.forEach((siblings) =>
      siblings.sort((a, b) => a.name.localeCompare(b.name)),
    );

    return map;
  }, [nodes]);

  const trimmedQuery = query.trim().toLowerCase();

  const searchMatches = useMemo(() => {
    if (trimmedQuery === '') return null;

    return nodes
      .filter(
        (node) =>
          node.path.toLowerCase().includes(trimmedQuery) ||
          node.code.toLowerCase().includes(trimmedQuery),
      )
      .slice(0, SEARCH_RESULT_CAP);
  }, [nodes, trimmedQuery]);

  function toggleExpanded(path: string) {
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  /** Depth-first over expanded branches only — collapsed subtrees cost nothing. */
  function visibleTreeRows(): CategoryMarginNodeViewModel[] {
    const rows: CategoryMarginNodeViewModel[] = [];
    const stack = [...(childrenByParent.get('') ?? [])].reverse();

    while (stack.length > 0) {
      const node = stack.pop() as CategoryMarginNodeViewModel;
      rows.push(node);

      if (node.childCount > 0 && expandedPaths.has(node.path)) {
        const children = childrenByParent.get(node.path) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push(children[index]);
        }
      }
    }

    return rows;
  }

  const rows = searchMatches ?? visibleTreeRows();

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full max-w-xs">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${nodes.length.toLocaleString()} categories…`}
          aria-label="Search categories"
          className="h-9 pl-8"
        />
      </div>

      <div
        role="table"
        aria-label="Category margins"
        className="overflow-hidden rounded-lg border border-border"
      >
        <div
          role="row"
          style={rowGridStyle(scopes.length)}
          className={`${ROW_GRID} border-b border-border bg-surface px-3 py-1.5`}
        >
          <span
            role="columnheader"
            className="text-[11px] font-bold tracking-wider text-ink-faint uppercase"
          >
            Category
          </span>
          {scopes.map((scope) => (
            <span
              key={scope.key}
              role="columnheader"
              title={scope.label}
              className="text-center text-[11px] font-bold tracking-wider text-ink-faint uppercase"
            >
              {scope.key}
            </span>
          ))}
          <span
            role="columnheader"
            className="sr-only text-right text-[11px] font-bold tracking-wider text-ink-faint uppercase"
          >
            History
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {searchMatches === null
              ? 'No categories are seeded in this environment yet.'
              : `No category matches "${query}".`}
          </p>
        ) : (
          rows.map((node) => (
            <CategoryMarginNodeRow
              key={node.categoryId}
              node={node}
              nodesByPath={nodesByPath}
              scopes={scopes}
              storeDefaults={storeDefaults}
              sellerAccountId={sellerAccountId}
              canManage={canManage}
              flat={searchMatches !== null}
              isExpanded={expandedPaths.has(node.path)}
              onToggleExpanded={() => toggleExpanded(node.path)}
            />
          ))
        )}
      </div>

      {searchMatches !== null && searchMatches.length === SEARCH_RESULT_CAP ? (
        <p className="text-xs text-ink-faint">
          Showing the first {SEARCH_RESULT_CAP} matches — keep typing to narrow
          further.
        </p>
      ) : null}
    </div>
  );
}
