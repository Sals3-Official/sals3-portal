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
 * whole column to "source" text; the scope columns now occupy that span, and
 * the source of an inherited rate is carried by the chip's outline and its
 * tooltip instead of by a column of its own.
 *
 * Scope columns are fixed-width and equal so the eye can compare a rate down a
 * column, which is the entire reason for showing them side by side. The
 * category column takes the slack. The track list itself moved to
 * `rowGridStyle()` when the count stopped being a constant.
 */
export const ROW_GRID = 'grid items-center gap-x-2';

/**
 * The column track list, derived from the scopes actually being rendered.
 *
 * An inline style rather than a Tailwind class because the count is data now:
 * it was `repeat(6,…)` until 2026-08-27, when Global became a seventh column,
 * and a hard-coded count is a layout that silently collapses the first time the
 * list changes. Tailwind cannot generate a class from a runtime number, so the
 * track list is the one thing here that does not go through a utility.
 */
export function rowGridStyle(scopeCount: number): {
  gridTemplateColumns: string;
} {
  return {
    gridTemplateColumns: `minmax(9rem,1fr) repeat(${scopeCount},minmax(3.5rem,4.5rem)) 2.75rem`,
  };
}

export type CategoryMarginPolicyViewModel = {
  id: string;
  targetMarginRate: string;
  roundingRule: RoundingRule;
  version: number;
  updatedAt: Date;
  /**
   * The destination this rule is for, or `null` for Global.
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
   * This category's own rules, keyed by **scope key** — a country code for the
   * six named destinations, `ALL_MARKETS_KEY` for Global.
   *
   * See `listCategoryMarginOverviewByMarket`, which files a `market_code IS
   * NULL` row under that key.
   */
  policies: Record<string, CategoryMarginPolicyViewModel>;
};

export type StoreDefaultSummary = {
  /**
   * The fallback markup, or `null` for "this seller has no fallback".
   *
   * Nullable since 2026-08-28 — the store-default row exists to carry the
   * operating-expense reserve now, and the editing screen no longer offers a
   * markup. A row with no rate covers nothing, which is why `effectiveMarginFor`
   * checks the rate rather than the row.
   */
  targetMarginRate: string | null;
  roundingRule: RoundingRule;
};

/** Where a node's effective margin actually comes from, for one scope. */
export type EffectiveMargin =
  | { source: 'SELF'; rate: string }
  | { source: 'ANCESTOR'; rate: string; ancestorName: string }
  | { source: 'STORE_DEFAULT'; rate: string }
  | { source: 'NONE' };

/**
 * The rule this category owns in one scope, if it has one.
 *
 * **One scope, no fallback** — owner decision 2026-08-27. This used to try the
 * destination and then fall back to the all-destinations rule, mirroring a
 * resolver that widened the same way. Both stopped: Global now covers only the
 * countries with no column of their own, so a rate set on Global must never be
 * shown in the Australia column, because the resolver would never use it there.
 *
 * Global is not a special case here. It arrives as just another key
 * (`ALL_MARKETS_KEY`, the key `listCategoryMarginOverviewByMarket` files a
 * `market_code IS NULL` row under), so the Global column looks itself up the
 * same way Australia does.
 */
function ownPolicyFor(
  node: CategoryMarginNodeViewModel,
  scopeKey: string,
): CategoryMarginPolicyViewModel | null {
  return node.policies[scopeKey] ?? null;
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
  scopeKey: string,
): EffectiveMargin {
  const own = ownPolicyFor(node, scopeKey);

  if (own !== null) {
    return { source: 'SELF', rate: own.targetMarginRate };
  }

  const segments = node.path.split(PATH_SEPARATOR);

  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const ancestorPath = segments.slice(0, depth).join(PATH_SEPARATOR);
    const ancestor = nodesByPath.get(ancestorPath);

    const inherited =
      ancestor === undefined ? null : ownPolicyFor(ancestor, scopeKey);

    if (ancestor !== undefined && inherited !== null) {
      return {
        source: 'ANCESTOR',
        rate: inherited.targetMarginRate,
        ancestorName: ancestor.name,
      };
    }
  }

  /*
    The RATE, not the row. A store default with a reserve but no markup is the
    normal shape now, and it covers nothing — `resolveProductPricing` returns
    `PRICING_POLICY_REQUIRED` for exactly that case. Checking the row alone
    would paint a rate into every "—" cell that the resolver would never use.
  */
  if (storeDefault !== null && storeDefault.targetMarginRate !== null) {
    return { source: 'STORE_DEFAULT', rate: storeDefault.targetMarginRate };
  }

  return { source: 'NONE' };
}
