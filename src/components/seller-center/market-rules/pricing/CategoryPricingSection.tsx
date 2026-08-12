import getDb from '@/lib/db/client';
import {
  groupCategoryMarginRowsByL2,
  listCategoryMarginOverview,
  type CategoryMarginGroup,
} from '@/modules/pricing/repository';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import CategoryMarginGroupList, {
  type CategoryMarginGroupViewModel,
} from './CategoryMarginGroupList';

type CategoryPricingSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
};

/**
 * Falls back to an honest "not available" read rather than crashing the
 * page when the pricing-policy schema is not migrated in this environment
 * yet (same discipline as `resolveFixtureVariantGuidance` — a missing
 * table is an operational condition, not a bug to surface as a 500).
 */
async function readCategoryMarginGroups(
  sellerAccountId: string,
): Promise<CategoryMarginGroup[] | null> {
  try {
    const rows = await listCategoryMarginOverview(getDb(), sellerAccountId);
    return groupCategoryMarginRowsByL2(rows);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read category pricing groups', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * Presentation shaping only — kept out of `repository.ts`, which stays
 * free of UI-state concepts. "Uniform" requires every leaf to be set AND
 * to share the same rate AND rounding; "no policy" is a distinct third
 * state from "set but differs," never conflated with a 0% assumption.
 */
function toViewModel(group: CategoryMarginGroup): CategoryMarginGroupViewModel {
  const activePolicies = group.leaves
    .map((leaf) => leaf.policy)
    .filter((policy): policy is NonNullable<typeof policy> => policy !== null);

  const setCount = activePolicies.length;
  const allUniform =
    setCount === group.leaves.length &&
    activePolicies.every(
      (policy) =>
        policy.targetMarginRate === activePolicies[0]?.targetMarginRate &&
        policy.roundingRule === activePolicies[0]?.roundingRule,
    );

  let marginState: CategoryMarginGroupViewModel['marginState'] = 'MIXED';
  if (setCount === 0) marginState = 'UNSET';
  else if (allUniform) marginState = 'UNIFORM';

  return {
    groupKey: group.groupKey,
    l1: group.l1,
    l2: group.l2,
    leafCount: group.leaves.length,
    setCount,
    marginState,
    uniformRate:
      marginState === 'UNIFORM'
        ? (activePolicies[0]?.targetMarginRate ?? null)
        : null,
    uniformRoundingRule:
      marginState === 'UNIFORM'
        ? (activePolicies[0]?.roundingRule ?? null)
        : null,
    leaves: group.leaves.map((leaf) => ({
      categoryId: leaf.categoryId,
      code: leaf.code,
      path: leaf.path,
      policy: leaf.policy,
    })),
  };
}

/** ADR-015 Phase 1: category-first manual margin policy, grouped by L1>L2. */
export default async function CategoryPricingSection({
  sellerAccountId,
  canManage,
}: CategoryPricingSectionProps) {
  const groups = await readCategoryMarginGroups(sellerAccountId);

  return (
    <section
      aria-labelledby="category-pricing-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h2 id="category-pricing-heading" className="text-base font-semibold">
          Category pricing
        </h2>
        <p className="max-w-[78ch] text-sm text-muted-foreground">
          Your target margin per Sals3 category — the normal default. A product
          can override it in the Product Editor.
        </p>
      </div>
      {groups === null ? (
        <DisclosureBanner tone="warning">
          Category pricing is not available right now. Your saved margins are
          safe. Try again shortly, or contact support if this keeps happening.
        </DisclosureBanner>
      ) : (
        <CategoryMarginGroupList
          groups={groups.map(toViewModel)}
          sellerAccountId={sellerAccountId}
          canManage={canManage}
        />
      )}
    </section>
  );
}
