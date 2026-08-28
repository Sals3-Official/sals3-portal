import getDb from '@/lib/db/client';
import {
  countDescendantsByPath,
  findStoreDefaultForScope,
  listCategoryMarginOverviewByMarket,
  type CategoryMarginMarketRow,
} from '@/modules/pricing/repository';
import type { PricingScope } from '@/modules/pricing/pricing-scope-destinations';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import CategoryMarginTree from './CategoryMarginTree';
import MarginCsvControls from './MarginCsvControls';
import type {
  CategoryMarginNodeViewModel,
  StoreDefaultSummary,
} from './category-margin-model';
import RepriceControls from './RepriceControls';

type CategoryPricingSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
  /** One column each, in the order they are shown — the six, then Global. */
  scopes: PricingScope[];
};

const PATH_SEPARATOR = ' > ';

/**
 * Falls back to an honest "not available" read rather than crashing the
 * page when the pricing-policy schema is not migrated in this environment
 * yet (same discipline as `resolveFixtureVariantGuidance` — a missing
 * table is an operational condition, not a bug to surface as a 500).
 */
async function readCategoryRows(sellerAccountId: string): Promise<{
  rows: CategoryMarginMarketRow[];
  descendantCounts: Map<string, number>;
} | null> {
  try {
    const db = getDb();
    const [rows, descendantCounts] = await Promise.all([
      listCategoryMarginOverviewByMarket(db, sellerAccountId),
      countDescendantsByPath(db),
    ]);

    return { rows, descendantCounts };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read category margin rows', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * Deliberately its own read with its own failure state, NOT bundled into
 * the taxonomy read above.
 *
 * These two answer different questions and fail for different reasons, and
 * one of them is the whole screen. When they shared a `Promise.all` inside
 * one `try`, a `pricing_store_defaults` table that did not exist yet took
 * the entire category tree down with it — a screen that had rendered 220
 * groups the day before showed only "not available", which is exactly the
 * silent, wider-than-necessary degradation this codebase keeps being bitten
 * by. Observed live on 2026-08-19 between the feature deploy and the
 * migration run.
 *
 * Three states, kept distinct: rows (a real default), `null` (read fine,
 * none configured — the ordinary first-run case), and `unavailable` (the
 * backend could not answer). Only the last is an error worth a banner; the
 * middle one is normal and the tree already renders it honestly.
 *
 * One read per scope, because a store default is scoped like every other rule.
 * Seven single-row index lookups, issued together — cheaper than the one
 * taxonomy scan beside it, and the alternative is showing one scope's floor
 * under every column.
 *
 * Keyed by `scope.key` but read by `scope.marketCode`: the Global row is stored
 * with `market_code IS NULL`, and `findStoreDefaultForScope` takes that `null`
 * as the scope to match rather than as "any scope".
 */
async function readStoreDefaults(
  sellerAccountId: string,
  scopes: PricingScope[],
): Promise<
  | { state: 'ok'; storeDefaults: Record<string, StoreDefaultSummary | null> }
  | { state: 'unavailable' }
> {
  try {
    const db = getDb();
    const rows = await Promise.all(
      scopes.map(async (scope) => {
        const storeDefault = await findStoreDefaultForScope(
          db,
          sellerAccountId,
          scope.marketCode,
        );

        return [
          scope.key,
          storeDefault === null
            ? null
            : {
                targetMarginRate: storeDefault.targetMarginRate,
                roundingRule: storeDefault.roundingRule,
              },
        ] as const;
      }),
    );

    return { state: 'ok', storeDefaults: Object.fromEntries(rows) };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read the store defaults for the tree', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { state: 'unavailable' };
  }
}

/**
 * Presentation shaping only — every taxonomy row becomes a tree node with
 * its depth, parent path, and child/subtree counts precomputed once here,
 * so the client walks Maps instead of re-scanning 5,595 paths per render.
 */
function toNodeViewModels(
  rows: CategoryMarginMarketRow[],
  descendantCounts: Map<string, number>,
): CategoryMarginNodeViewModel[] {
  // `childCount` is derived from the ROWS — it drives the expand chevron, so
  // it must describe what this view can actually render. `subtreeCount` is
  // taken from the full-taxonomy counts instead, because it describes what a
  // margin set here will really cover; deriving it from depth-capped rows is
  // what made "Home & Garden — 1,034 categories" render as "21".
  const childCounts = new Map<string, number>();

  rows.forEach((row) => {
    const segments = row.path.split(PATH_SEPARATOR);
    const parentPath =
      segments.length > 1 ? segments.slice(0, -1).join(PATH_SEPARATOR) : null;

    if (parentPath !== null) {
      childCounts.set(parentPath, (childCounts.get(parentPath) ?? 0) + 1);
    }
  });

  return rows.map((row) => {
    const segments = row.path.split(PATH_SEPARATOR);

    return {
      categoryId: row.categoryId,
      code: row.code,
      path: row.path,
      name: segments[segments.length - 1],
      depth: segments.length,
      parentPath:
        segments.length > 1 ? segments.slice(0, -1).join(PATH_SEPARATOR) : null,
      childCount: childCounts.get(row.path) ?? 0,
      subtreeCount: descendantCounts.get(row.path) ?? 0,
      policies: row.policies,
    };
  });
}

/**
 * ADR-015 Phase 1, reworked 2026-08-19 into an inheritance tree and again on
 * 2026-08-25 into a column per destination.
 *
 * The scope selector this replaces made comparing two countries a task:
 * reload the page, hold the previous number in your head. Freight to Fiji is
 * roughly four times freight to the Philippines, so the comparison is the
 * point — and a screen showing one destination at a time hides exactly what
 * the seller came to decide.
 *
 * A seventh column, Global, was added 2026-08-27. It is a scope like the other
 * six, not a summary of them: it prices the countries that have no column here,
 * and a rate set on it is never shown or used in a named destination's column.
 */
export default async function CategoryPricingSection({
  sellerAccountId,
  canManage,
  scopes,
}: CategoryPricingSectionProps) {
  // Independent reads: a store-default failure must never hide the tree.
  const [categoryData, storeDefaultResult] = await Promise.all([
    readCategoryRows(sellerAccountId),
    readStoreDefaults(sellerAccountId, scopes),
  ]);

  const storeDefaults =
    storeDefaultResult.state === 'ok' ? storeDefaultResult.storeDefaults : {};
  const scopesWithoutDefault = scopes.filter(
    (scope) => (storeDefaults[scope.key] ?? null) === null,
  );

  return (
    <section
      aria-labelledby="category-pricing-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="category-pricing-heading" className="text-base font-semibold">
            Category markups
          </h2>
          <p className="max-w-[78ch] text-sm text-muted-foreground">
            One column per destination, plus Global for every country without a
            column of its own. A category without its own markup in a column
            uses the nearest parent above it. Set a markup only where a
            department genuinely differs; a product can still override it in the
            Product Editor.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Back beside the margins, at the owner's ask, but never without the
            tooltip: `planReprice` takes a **seller**, not a category, and reads
            every pricing rule on this page — the store default, these margins,
            product and variant overrides, and the funding buffer. Sitting in
            this header implies a scope it does not have, so the icon is what
            keeps the placement honest. Do not ship one without the other.
          */}
          <RepriceControls canManage={canManage} />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="What repricing covers"
                  className="inline-flex text-muted-foreground hover:text-foreground"
                >
                  <Info aria-hidden="true" className="size-3.5" />
                </button>
              }
            />
            <TooltipContent className="max-w-xs">
              <span className="flex flex-col gap-1.5">
                <span className="font-medium">Apply rules to live prices</span>
                <span>
                  A published price is worked out once, when the product goes
                  live, so a rule saved here changes nothing a buyer is charged
                  until you reprice.
                </span>
                <span>
                  It covers every rule on this page — store defaults, these
                  category markups, and the funding buffer — not just the
                  category you last edited. You see exactly what would change
                  before anything is written, and prices you typed by hand are
                  never touched unless you ask for them.
                </span>
              </span>
            </TooltipContent>
          </Tooltip>
          {categoryData === null ? null : (
            <MarginCsvControls
              nodes={toNodeViewModels(
                categoryData.rows,
                categoryData.descendantCounts,
              )}
              scopes={scopes}
              canManage={canManage}
            />
          )}
        </div>
      </div>
      {categoryData === null ? (
        <DisclosureBanner tone="warning">
          Category pricing is not available right now. Your saved margins are
          safe. Try again shortly, or contact support if this keeps happening.
        </DisclosureBanner>
      ) : (
        <>
          {storeDefaultResult.state === 'unavailable' ? (
            <DisclosureBanner tone="warning">
              Your store defaults could not be read, so the inherited rates
              below are incomplete — a category with no markup of its own may
              still be covered by a default this page cannot see right now.
              Markups set on a category are unaffected.
            </DisclosureBanner>
          ) : null}
          {storeDefaultResult.state === 'ok' &&
          scopesWithoutDefault.length > 0 ? (
            <DisclosureBanner tone="warning">
              No store default exists yet for{' '}
              {scopesWithoutDefault.map((scope) => scope.label).join(', ')}, so
              a category shown as &quot;—&quot; in those columns cannot price at
              all — its products need a manual retail price until a default or a
              parent markup covers them.
            </DisclosureBanner>
          ) : null}
          <CategoryMarginTree
            nodes={toNodeViewModels(
              categoryData.rows,
              categoryData.descendantCounts,
            )}
            scopes={scopes}
            storeDefaults={storeDefaults}
            sellerAccountId={sellerAccountId}
            canManage={canManage}
          />
        </>
      )}
    </section>
  );
}
