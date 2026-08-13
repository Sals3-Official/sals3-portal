'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RoundingRule } from '@/modules/pricing/money-math';
import CategoryMarginGroupRow from './CategoryMarginGroupRow';

export type CategoryMarginLeafViewModel = {
  categoryId: string;
  code: string;
  path: string;
  policy: {
    id: string;
    targetMarginRate: string;
    roundingRule: RoundingRule;
    version: number;
    updatedAt: Date;
  } | null;
};

export type CategoryMarginGroupState = 'UNSET' | 'UNIFORM' | 'MIXED';

export type CategoryMarginGroupViewModel = {
  groupKey: string;
  l1: string;
  l2: string;
  leafCount: number;
  setCount: number;
  marginState: CategoryMarginGroupState;
  uniformRate: string | null;
  uniformRoundingRule: RoundingRule | null;
  leaves: CategoryMarginLeafViewModel[];
};

type CategoryMarginGroupListProps = {
  groups: CategoryMarginGroupViewModel[];
  sellerAccountId: string;
  canManage: boolean;
};

const COLUMN_HEADINGS = [
  'Category group',
  'State',
  'Margin',
  'Rounding',
  'Reason for change',
];

/**
 * Client-side filter over the already-fully-loaded group/leaf list — no
 * server round trip on keystroke, so there is no request volume to
 * debounce (the bug class this replaces, not just its timing). Matching a
 * group's own L1/L2 keeps it visible unexpanded even if the match is on
 * the group name itself, not one of its leaves.
 */
function matchesQuery(
  group: CategoryMarginGroupViewModel,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (group.l1.toLowerCase().includes(q)) return true;
  if (group.l2.toLowerCase().includes(q)) return true;
  return group.leaves.some(
    (leaf) =>
      leaf.path.toLowerCase().includes(q) ||
      leaf.code.toLowerCase().includes(q),
  );
}

/**
 * Category-margin setup (ADR-015 Phase 1), redesigned as an inline grouped
 * list — one row per Sals3 L1>L2 department/sub-department group, always
 * all 226 rendered (a group with nothing configured yet still appears,
 * showing "Not set" — never hidden). No modal anywhere in this flow;
 * `CategoryMarginGroupRow` owns the inline bulk-apply Save, and expanding a
 * group reveals its individual leaves via `CategoryMarginLeafRow`.
 */
export default function CategoryMarginGroupList({
  groups,
  sellerAccountId,
  canManage,
}: CategoryMarginGroupListProps) {
  const [query, setQuery] = useState('');
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  const visible = useMemo(
    () => groups.filter((group) => matchesQuery(group, query)),
    [groups, query],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex items-center">
          <Search
            aria-hidden="true"
            className="absolute left-2.5 size-3.5 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by department or category…"
            aria-label="Search categories"
            className="h-9 w-72 pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {visible.length} of {groups.length} shown
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[64rem]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-7">
                  <span className="sr-only">Expand</span>
                </TableHead>
                {COLUMN_HEADINGS.map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
                <TableHead className="w-[92px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
                <TableHead className="w-9">
                  <span className="sr-only">History</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={COLUMN_HEADINGS.length + 3}
                    className="py-10 text-center"
                  >
                    <p className="text-sm font-medium text-ink-muted">
                      No department or category matches that search.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Clear the search to see all {groups.length} groups.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((group) => (
                  <CategoryMarginGroupRow
                    key={group.groupKey}
                    group={group}
                    sellerAccountId={sellerAccountId}
                    canManage={canManage}
                    isExpanded={expandedGroupKey === group.groupKey}
                    onToggleExpanded={() =>
                      setExpandedGroupKey((previous) =>
                        previous === group.groupKey ? null : group.groupKey,
                      )
                    }
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
