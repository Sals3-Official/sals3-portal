import getDb from '@/lib/db/client';
import { findActiveFundingBufferPolicy } from '@/modules/pricing/repository';
import type { PricingFxAdjustmentPolicyRow } from '@/lib/db/schema';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import FundingBufferCard from './FundingBufferCard';

type FundingBufferSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
};

/**
 * `null` means the backend could not answer (unmigrated schema, database
 * down) — distinct from a successful read that finds no active buffer,
 * which is the ordinary first-run state `FundingBufferCard` itself renders.
 * Same discipline as `CategoryPricingSection`.
 */
async function readFundingBufferPolicy(
  sellerAccountId: string,
): Promise<
  { ok: true; policy: PricingFxAdjustmentPolicyRow | null } | { ok: false }
> {
  try {
    const policy = await findActiveFundingBufferPolicy(
      getDb(),
      sellerAccountId,
    );
    return { ok: true, policy };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read the funding buffer policy', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false };
  }
}

/**
 * ADR-015 §4: the seller's own funding buffer — a flat cost-basis uplift
 * for the seller's real funding/conversion exposure (e.g. converting AUD
 * to top up a CJ Wallet), separate from category margin and from the
 * platform reference rate (which this screen never lets a seller edit —
 * see `src/modules/pricing/reference-fx.ts`).
 */
export default async function FundingBufferSection({
  sellerAccountId,
  canManage,
}: FundingBufferSectionProps) {
  const result = await readFundingBufferPolicy(sellerAccountId);

  return (
    <section
      aria-labelledby="funding-buffer-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="funding-buffer-heading" className="text-base font-semibold">
          Funding buffer
        </h2>
        <p className="max-w-[78ch] text-sm text-muted-foreground">
          Covers what currency conversion costs you. It lifts your cost basis
          when you publish, and the approximate local price buyers see on the
          storefront. One buffer is active at a time.
        </p>
        <p className="max-w-[78ch] text-sm text-muted-foreground">
          Saving a new buffer updates the approximate local price straight away,
          but not what anyone is charged: published prices keep the buffer they
          were worked out with until you run{' '}
          <span className="font-medium">Apply rules to live prices</span> below.
        </p>
      </div>
      {result.ok ? (
        <FundingBufferCard
          policy={result.policy}
          sellerAccountId={sellerAccountId}
          canManage={canManage}
        />
      ) : (
        <DisclosureBanner tone="warning">
          Funding buffer is not available right now. Your saved buffer, if any,
          is safe. Try again shortly, or contact support if this keeps
          happening.
        </DisclosureBanner>
      )}
    </section>
  );
}
