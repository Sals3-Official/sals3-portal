import getDb from '@/lib/db/client';
import { findStoreDefaultForScope } from '@/modules/pricing/repository';
import type { PricingStoreDefaultRow } from '@/lib/db/schema';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import StoreDefaultCard from './StoreDefaultCard';

type StoreDefaultSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
};

/**
 * `null` means the backend could not answer (unmigrated schema, database
 * down) — distinct from a successful read that finds no active default,
 * which is the ordinary first-run state `StoreDefaultCard` itself renders.
 * Same discipline as `FundingBufferSection`.
 */
async function readStoreDefault(
  sellerAccountId: string,
): Promise<
  { ok: true; policy: PricingStoreDefaultRow | null } | { ok: false }
> {
  try {
    const policy = await findStoreDefaultForScope(
      getDb(),
      sellerAccountId,
      null,
    );
    return { ok: true, policy };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read the store default', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false };
  }
}

/**
 * ADR-015 §3's "seller/store default" base layer: one margin, one
 * minimum-contribution floor, one rounding rule, covering every category
 * that has no margin of its own and no priced parent.
 */
export default async function StoreDefaultSection({
  sellerAccountId,
  canManage,
}: StoreDefaultSectionProps) {
  const result = await readStoreDefault(sellerAccountId);

  return (
    <section
      aria-labelledby="store-default-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-7 w-1 shrink-0 rounded-full bg-sals3-gradient"
        />
        <div className="flex flex-col gap-1">
          <h2 id="store-default-heading" className="text-base font-semibold">
            Store default pricing
          </h2>
          <p className="max-w-[78ch] text-sm text-muted-foreground">
            These two numbers make the selling price. The system starts with the
            supplier cost. Then it adds your margin. You do not set a price for
            each product. Every category uses these numbers. A department can
            use its own margin. Set that in the list below.
          </p>
        </div>
      </div>
      {result.ok ? (
        <StoreDefaultCard
          policy={result.policy}
          sellerAccountId={sellerAccountId}
          canManage={canManage}
        />
      ) : (
        <DisclosureBanner tone="warning">
          Store default pricing is not available right now. Your saved default,
          if any, is safe. Try again shortly, or contact support if this keeps
          happening.
        </DisclosureBanner>
      )}
    </section>
  );
}
