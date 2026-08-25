import getDb from '@/lib/db/client';
import {
  countDescendantsByPath,
  findStoreDefaultForScope,
  listCategoryMarginOverview,
  type CategoryMarginLeafRow,
} from '@/modules/pricing/repository';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import CategoryMarginTree from './CategoryMarginTree';
import DestinationScopeSelector, {
  type DestinationOption,
} from './DestinationScopeSelector';
import MarginCsvControls from './MarginCsvControls';
import type {
  CategoryMarginNodeViewModel,
  StoreDefaultSummary,
} from './category-margin-model';

type CategoryPricingSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
  /**
   * The destination scope this render is for. `null` is the all-destinations
   * rule. Read from the URL by the page, so the scope displayed and the scope
   * saved are one value from one place.
   */
  marketCode: string | null;
  destinationOptions: DestinationOption[];
};

const PATH_SEPARATOR = ' > ';

/**
 * Falls back to an honest "not available" read rather than crashing the
 * page when the pricing-policy schema is not migrated in this environment
 * yet (same discipline as `resolveFixtureVariantGuidance` — a missing
 * table is an operational condition, not a bug to surface as a 500).
 */
async function readCategoryRows(
  sellerAccountId: string,
  marketCode: string | null,
): Promise<{
  rows: CategoryMarginLeafRow[];
  descendantCounts: Map<string, number>;
} | null> {
  try {
    const db = getDb();
    const [rows, descendantCounts] = await Promise.all([
      listCategoryMarginOverview(db, sellerAccountId, marketCode),
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
 */
async function readStoreDefault(
  sellerAccountId: string,
  marketCode: string | null,
): Promise<
  | { state: 'ok'; storeDefault: StoreDefaultSummary | null }
  | { state: 'unavailable' }
> {
  try {
    const storeDefault = await findStoreDefaultForScope(
      getDb(),
      sellerAccountId,
      marketCode,
    );

    return {
      state: 'ok',
      storeDefault:
        storeDefault === null
          ? null
          : {
              targetMarginRate: storeDefault.targetMarginRate,
              roundingRule: storeDefault.roundingRule,
            },
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read the store default for the tree', {
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
  rows: CategoryMarginLeafRow[],
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
      policy: row.policy,
    };
  });
}

/**
 * ADR-015 Phase 1, reworked 2026-08-19: category margin as an inheritance
 * tree. A category without its own margin inherits the nearest priced
 * ancestor, then the store default — so a handful of department policies
 * covers everything, and the old per-leaf bulk fan-out (5,595 rows per
 * seller per change) is gone.
 */
export default async function CategoryPricingSection({
  sellerAccountId,
  canManage,
  marketCode,
  destinationOptions,
}: CategoryPricingSectionProps) {
  // Independent reads: a store-default failure must never hide the tree.
  const [categoryData, storeDefaultResult] = await Promise.all([
    readCategoryRows(sellerAccountId, marketCode),
    readStoreDefault(sellerAccountId, marketCode),
  ]);

  const storeDefault =
    storeDefaultResult.state === 'ok' ? storeDefaultResult.storeDefault : null;

  return (
    <section
      aria-labelledby="category-pricing-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="category-pricing-heading" className="text-base font-semibold">
            Category margins
          </h2>
          <p className="max-w-[78ch] text-sm text-muted-foreground">
            A category without its own margin uses the nearest parent above it.
            Set a margin only where a department genuinely differs; a product
            can still override it in the Product Editor.
          </p>
          {destinationOptions.length > 1 ? (
            <div className="mt-3">
              <DestinationScopeSelector
                options={destinationOptions}
                selected={marketCode}
              />
            </div>
          ) : null}
        </div>
        {categoryData === null ? null : (
          <MarginCsvControls
            nodes={toNodeViewModels(
              categoryData.rows,
              categoryData.descendantCounts,
            )}
            canManage={canManage}
          />
        )}
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
              Your store default could not be read, so the inherited rates below
              are incomplete — a category with no margin of its own may still be
              covered by a default this page cannot see right now. Margins set
              on a category are unaffected.
            </DisclosureBanner>
          ) : null}
          {storeDefaultResult.state === 'ok' && storeDefault === null ? (
            <DisclosureBanner tone="warning">
              No store default exists yet, so a category shown as &quot;Not
              set&quot; cannot price at all — its products need a manual retail
              price until a default or a parent margin covers them.
            </DisclosureBanner>
          ) : null}
          <CategoryMarginTree
            nodes={toNodeViewModels(
              categoryData.rows,
              categoryData.descendantCounts,
            )}
            storeDefault={storeDefault}
            sellerAccountId={sellerAccountId}
            canManage={canManage}
            marketCode={marketCode}
          />
        </>
      )}
    </section>
  );
}
