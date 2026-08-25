import type { RoundingRule } from '@/modules/pricing/money-math';
import { ALL_MARKETS_KEY } from '@/modules/pricing/repository';

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

export { ALL_MARKETS_KEY };

/**
 * One grid definition shared by the header and every row, so the two can
 * never drift.
 *
 * Owner decision 2026-08-25 replaced the scope selector with a column per
 * destination, which changed what this grid has to do. The old layout gave a
 * whole column to "source" text; the six destination columns now occupy that
 * span, and the source of an inherited rate is carried by the chip's outline
 * and its tooltip instead of by a column of its own.
 *
 * Destination columns are fixed-width and equal so the eye can compare a rate
 * down a column, which is the entire reason for showing them side by side. The
 * category column takes the slack.
 */
export const ROW_GRID =
  'grid grid-cols-[minmax(9rem,1fr)_repeat(6,minmax(3.5rem,4.5rem))_2.75rem] items-center gap-x-2';

export type CategoryMarginPolicyViewModel = {
  id: string;
  targetMarginRate: string;
  roundingRule: RoundingRule;
  version: number;
  updatedAt: Date;
  /**
   * The destination this rule is for, or `null` for all destinations.
   *
   * Carried on the view model, not only in the query, because the CSV export
   * is built from these nodes — a file that did not say which scope it came
   * from could be imported onto a different destination in one click.
   */
  marketCode: string | null;
};

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
  /**
   * This category's own rules, keyed by destination.
   *
   * An all-destinations rule, if one still exists, is keyed by
   * `ALL_MARKETS_KEY` — see `listCategoryMarginOverviewByMarket`.
   */
  policies: Record<string, CategoryMarginPolicyViewModel>;
};

export type StoreDefaultSummary = {
  targetMarginRate: string;
  roundingRule: RoundingRule;
};

/** Where a node's effective margin actually comes from, for one destination. */
export type EffectiveMargin =
  | { source: 'SELF'; rate: string; viaAllMarkets: boolean }
  | {
      source: 'ANCESTOR';
      rate: string;
      ancestorName: string;
      viaAllMarkets: boolean;
    }
  | { source: 'STORE_DEFAULT'; rate: string }
  | { source: 'NONE' };

/**
 * The rule that applies to one category in one destination, if it has one.
 *
 * Destination first, all-destinations second — the same precedence the
 * resolver applies through `outranks`, where depth beats market and a
 * market-scoped rule only wins against an unscoped one at the same depth.
 * Reversing these two here would show a rate the resolver would never use.
 */
function ownPolicyFor(
  node: CategoryMarginNodeViewModel,
  marketCode: string,
): { policy: CategoryMarginPolicyViewModel; viaAllMarkets: boolean } | null {
  const scoped = node.policies[marketCode];

  if (scoped !== undefined) return { policy: scoped, viaAllMarkets: false };

  const allMarkets = node.policies[ALL_MARKETS_KEY];

  if (allMarkets !== undefined)
    return { policy: allMarkets, viaAllMarkets: true };

  return null;
}

/**
 * Mirrors the resolver's `findNearestActiveCategoryPolicy` walk, for one
 * destination: self, then each ancestor by path prefix, then the store default.
 *
 * Display-only — the server-side resolver is the authority; this exists so the
 * tree can say where a rate comes from without a round trip per row, and now
 * without one per row per destination.
 */
export function effectiveMarginFor(
  node: CategoryMarginNodeViewModel,
  nodesByPath: Map<string, CategoryMarginNodeViewModel>,
  storeDefault: StoreDefaultSummary | null,
  marketCode: string,
): EffectiveMargin {
  const own = ownPolicyFor(node, marketCode);

  if (own !== null) {
    return {
      source: 'SELF',
      rate: own.policy.targetMarginRate,
      viaAllMarkets: own.viaAllMarkets,
    };
  }

  const segments = node.path.split(PATH_SEPARATOR);

  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const ancestorPath = segments.slice(0, depth).join(PATH_SEPARATOR);
    const ancestor = nodesByPath.get(ancestorPath);

    const inherited =
      ancestor === undefined ? null : ownPolicyFor(ancestor, marketCode);

    if (ancestor !== undefined && inherited !== null) {
      return {
        source: 'ANCESTOR',
        rate: inherited.policy.targetMarginRate,
        ancestorName: ancestor.name,
        viaAllMarkets: inherited.viaAllMarkets,
      };
    }
  }

  if (storeDefault !== null) {
    return { source: 'STORE_DEFAULT', rate: storeDefault.targetMarginRate };
  }

  return { source: 'NONE' };
}
