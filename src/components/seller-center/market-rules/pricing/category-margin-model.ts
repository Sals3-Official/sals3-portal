import type { RoundingRule } from '@/modules/pricing/money-math';

/**
 * Shared vocabulary for the category-margin tree: the row shape, the grid,
 * and the display-side inheritance walk.
 *
 * Its own module rather than living on `CategoryMarginTree` because the row
 * needs the grid and the types while the tree needs the row — importing
 * across those two directly is a dependency cycle (`import/no-cycle`), and
 * the cycle is the honest signal that this vocabulary belongs to neither
 * component in particular.
 */

export const PATH_SEPARATOR = ' > ';

/**
 * One grid definition shared by the header and every row, so the two can
 * never drift.
 *
 * The category column is CAPPED rather than a bare `1fr`. At `1fr` it took
 * 599px of a 1440px viewport while its longest content needed about 200 —
 * the margin chip and the source that explains it were flung to the far
 * right with a dead gulf between. The slack now goes to the source column,
 * which is the one carrying variable-length text ("From Apparel &
 * Accessories").
 */
export const ROW_GRID =
  'grid grid-cols-[minmax(11rem,22rem)_6rem_minmax(0,1fr)_11.5rem] items-center gap-x-3';

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
  /** Direct children present in this view — drives the expand chevron. */
  childCount: number;
  /** All descendants in the full taxonomy — the "N categories" count. */
  subtreeCount: number;
  policy: {
    id: string;
    targetMarginRate: string;
    roundingRule: RoundingRule;
    version: number;
    updatedAt: Date;
    /**
     * The destination this rule was read for, or `null` for all destinations.
     *
     * Carried on the view model, not only in the query, because the CSV export
     * is built from these nodes — a file that did not say which scope it came
     * from could be imported onto a different destination in one click.
     */
    marketCode: string | null;
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

/**
 * Mirrors the resolver's `findNearestActiveCategoryPolicy` walk: self, then
 * each ancestor by path prefix, then the store default. Display-only — the
 * server-side resolver is the authority; this exists so the tree can say
 * where a rate comes from without a round trip per row.
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
