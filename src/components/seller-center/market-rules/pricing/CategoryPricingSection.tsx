import getDb from '@/lib/db/client';
import {
  listActiveCategoryPolicies,
  type CategoryPolicyWithCategory,
} from '@/modules/pricing/repository';
import CategoryPolicyFormDialog from './CategoryPolicyFormDialog';
import CategoryPricingTable from './CategoryPricingTable';

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
async function readCategoryPolicies(
  sellerAccountId: string,
): Promise<CategoryPolicyWithCategory[] | null> {
  try {
    return await listActiveCategoryPolicies(getDb(), sellerAccountId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read category pricing policies', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

function emptyStateMessage(
  policies: CategoryPolicyWithCategory[] | null,
): string | null {
  if (policies === null) return 'Category pricing is not available right now.';
  if (policies.length === 0) {
    return 'No pricing policy yet — products in this category cannot receive price guidance or become price-ready.';
  }
  return null;
}

/** ADR-015 Phase 1: category-first manual margin policy. */
export default async function CategoryPricingSection({
  sellerAccountId,
  canManage,
}: CategoryPricingSectionProps) {
  const policies = await readCategoryPolicies(sellerAccountId);
  const emptyMessage = emptyStateMessage(policies);

  return (
    <section
      aria-labelledby="category-pricing-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="category-pricing-heading" className="text-base font-semibold">
            Category pricing
          </h2>
          <p className="text-sm text-muted-foreground">
            Your target margin by Sals3 category — the normal default. Product
            and variant overrides are exceptions, not routine work.
          </p>
        </div>
        {canManage ? <CategoryPolicyFormDialog mode="create" /> : null}
      </div>
      {emptyMessage === null && policies !== null ? (
        <CategoryPricingTable
          policies={policies}
          sellerAccountId={sellerAccountId}
          canManage={canManage}
        />
      ) : (
        <p className="rounded-md border border-dashed border-border-strong bg-background px-3 py-4 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      )}
    </section>
  );
}
