'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { RoundingRule } from '@/modules/pricing/money-math';
import CategoryMarginNodeRow from './CategoryMarginNodeRow';

export type CategoryMarginNodeViewModel = {
  categoryId: string;
  code: string;
  /** Full denormalized path, e.g. "Apparel & Accessories > Clothing". */
  path: string;
  /** Last path segment — the display name at this depth. */
  name: string;
  /** 1-based; departments are depth 1. */
  depth: number;
  parentPath: string | null;
  /** Direct children — drives the expand chevron. */
  childCount: number;
  /** All descendants — the "N categories" count on a branch. */
  subtreeCount: number;
  policy: {
    id: string;
    targetMarginRate: string;
    roundingRule: RoundingRule;
    version: number;
    updatedAt: Date;
  } | null;
};

export type StoreDefaultSummary = {
  targetMarginRate: string;
  roundingRule: RoundingRule;
};

/** Where a node's effective margin actually comes from. */
export type EffectiveMargin =
  | { source: 'SELF'; rate: string }
  | { source: 'ANCESTOR'; rate: string; ancestorName: string }
  | { source: 'STORE_DEFAULT'; rate: string }
  | { source: 'NONE' };

const PATH_SEPARATOR = ' > ';
const SEARCH_RESULT_CAP = 50;

/**
 * Mirrors the resolver's `findNearestActiveCategoryPolicy` walk: self,
 * then each ancestor by path prefix, then the store default. Display-only —
 * the server-side resolver is the authority; this exists so the tree can
 * say where a rate would come from without a round trip per row.
 */
export function effectiveMarginFor(
  node: CategoryMarginNodeViewModel,
  nodesByPath: Map<string, CategoryMarginNodeViewModel>,
  storeDefault: StoreDefaultSummary | null,
): EffectiveMargin {
  if (node.policy !== null) {
    return { source: 'SELF', rate: node.policy.targetMarginRate };
  }

  const segments = node.path.split(PATH_SEPARATOR);

  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const ancestorPath = segments.slice(0, depth).join(PATH_SEPARATOR);
    const ancestor = nodesByPath.get(ancestorPath);

    if (ancestor !== undefined && ancestor.policy !== null) {
      return {
        source: 'ANCESTOR',
        rate: ancestor.policy.targetMarginRate,
        ancestorName: ancestor.name,
      };
    }
  }

  if (storeDefault !== null) {
    return { source: 'STORE_DEFAULT', rate: storeDefault.targetMarginRate };
  }

  return { source: 'NONE' };
}

type CategoryMarginTreeProps = {
  nodes: CategoryMarginNodeViewModel[];
  storeDefault: StoreDefaultSummary | null;
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
  storeDefault,
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
          className="grid grid-cols-[minmax(0,1fr)_130px_minmax(140px,210px)_auto] items-center gap-3 border-b border-border bg-surface px-3 py-2"
        >
          <span
            role="columnheader"
            className="text-[11px] font-bold tracking-wider text-ink-faint uppercase"
          >
            Category
          </span>
          <span
            role="columnheader"
            className="text-[11px] font-bold tracking-wider text-ink-faint uppercase"
          >
            Effective margin
          </span>
          <span
            role="columnheader"
            className="text-[11px] font-bold tracking-wider text-ink-faint uppercase"
          >
            Source
          </span>
          <span
            role="columnheader"
            className="text-right text-[11px] font-bold tracking-wider text-ink-faint uppercase"
          >
            Actions
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
              effective={effectiveMarginFor(node, nodesByPath, storeDefault)}
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
