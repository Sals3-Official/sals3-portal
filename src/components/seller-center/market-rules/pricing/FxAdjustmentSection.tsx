import getDb from '@/lib/db/client';
import { listActiveFxAdjustmentPolicies } from '@/modules/pricing/repository';
import type { PricingFxAdjustmentPolicyRow } from '@/lib/db/schema';
import FxAdjustmentFormDialog from './FxAdjustmentFormDialog';
import FxAdjustmentTable from './FxAdjustmentTable';

type FxAdjustmentSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
};

/** Same "not available" fallback as `CategoryPricingSection` — see its comment. */
async function readFxAdjustmentPolicies(
  sellerAccountId: string,
): Promise<PricingFxAdjustmentPolicyRow[] | null> {
  try {
    return await listActiveFxAdjustmentPolicies(getDb(), sellerAccountId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read FX adjustment policies', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

function emptyStateMessage(
  policies: PricingFxAdjustmentPolicyRow[] | null,
): string | null {
  if (policies === null) return 'FX adjustment is not available right now.';
  if (policies.length === 0) {
    return 'No FX adjustment configured. Products priced in a currency that matches your settlement currency (USD, phase 1) do not need one — this only applies when a real conversion is required.';
  }
  return null;
}

/**
 * ADR-015 §4: the seller's own FX adjustment, separate from category
 * margin and from the platform reference rate (which this screen never
 * lets a seller edit — see `src/modules/pricing/reference-fx.ts`).
 */
export default async function FxAdjustmentSection({
  sellerAccountId,
  canManage,
}: FxAdjustmentSectionProps) {
  const policies = await readFxAdjustmentPolicies(sellerAccountId);
  const emptyMessage = emptyStateMessage(policies);

  return (
    <section
      aria-labelledby="fx-adjustment-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="fx-adjustment-heading" className="text-base font-semibold">
            FX adjustment
          </h2>
          <p className="text-sm text-muted-foreground">
            Your own buffer for a real funding/conversion exposure, by currency
            pair and funding rail. Never a category default and never the
            platform reference rate itself.
          </p>
        </div>
        {canManage ? <FxAdjustmentFormDialog mode="create" /> : null}
      </div>
      {emptyMessage === null && policies !== null ? (
        <FxAdjustmentTable
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
