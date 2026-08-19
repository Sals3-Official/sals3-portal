import getDb from '@/lib/db/client';
import {
  findActiveStoreDefault,
  listCategoryMarginOverview,
  type CategoryMarginLeafRow,
} from '@/modules/pricing/repository';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import CategoryMarginTree, {
  type CategoryMarginNodeViewModel,
  type StoreDefaultSummary,
} from './CategoryMarginTree';

type CategoryPricingSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
};

const PATH_SEPARATOR = ' > ';

/**
 * Falls back to an honest "not available" read rather than crashing the
 * page when the pricing-policy schema is not migrated in this environment
 * yet (same discipline as `resolveFixtureVariantGuidance` — a missing
 * table is an operational condition, not a bug to surface as a 500).
 */
async function readCategoryPricing(sellerAccountId: string): Promise<{
  rows: CategoryMarginLeafRow[];
  storeDefault: StoreDefaultSummary | null;
} | null> {
  try {
    const db = getDb();
    const [rows, storeDefault] = await Promise.all([
      listCategoryMarginOverview(db, sellerAccountId),
      findActiveStoreDefault(db, sellerAccountId),
    ]);

    return {
      rows,
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
    console.error('[portal] failed to read category pricing', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * Presentation shaping only — every taxonomy row becomes a tree node with
 * its depth, parent path, and child/subtree counts precomputed once here,
 * so the client walks Maps instead of re-scanning 5,595 paths per render.
 */
function toNodeViewModels(
  rows: CategoryMarginLeafRow[],
): CategoryMarginNodeViewModel[] {
  const childCounts = new Map<string, number>();
  const subtreeCounts = new Map<string, number>();

  rows.forEach((row) => {
    const segments = row.path.split(PATH_SEPARATOR);
    const parentPath =
      segments.length > 1 ? segments.slice(0, -1).join(PATH_SEPARATOR) : null;

    if (parentPath !== null) {
      childCounts.set(parentPath, (childCounts.get(parentPath) ?? 0) + 1);
    }

    // Every strict ancestor gains one descendant.
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestorPath = segments.slice(0, depth).join(PATH_SEPARATOR);
      subtreeCounts.set(
        ancestorPath,
        (subtreeCounts.get(ancestorPath) ?? 0) + 1,
      );
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
      subtreeCount: subtreeCounts.get(row.path) ?? 0,
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
}: CategoryPricingSectionProps) {
  const data = await readCategoryPricing(sellerAccountId);

  return (
    <section
      aria-labelledby="category-pricing-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h2 id="category-pricing-heading" className="text-base font-semibold">
          Category margins
        </h2>
        <p className="max-w-[78ch] text-sm text-muted-foreground">
          A category without its own margin inherits the nearest parent above
          it, then the store default. Set a margin only where a department
          genuinely differs; a product can still override it in the Product
          Editor.
        </p>
      </div>
      {data === null ? (
        <DisclosureBanner tone="warning">
          Category pricing is not available right now. Your saved margins are
          safe. Try again shortly, or contact support if this keeps happening.
        </DisclosureBanner>
      ) : (
        <>
          {data.storeDefault === null ? (
            <DisclosureBanner tone="warning">
              No store default exists yet, so a category shown as &quot;Not
              set&quot; cannot price at all — its products need a manual retail
              price until a default or a parent margin covers them.
            </DisclosureBanner>
          ) : null}
          <CategoryMarginTree
            nodes={toNodeViewModels(data.rows)}
            storeDefault={data.storeDefault}
            sellerAccountId={sellerAccountId}
            canManage={canManage}
          />
        </>
      )}
    </section>
  );
}
