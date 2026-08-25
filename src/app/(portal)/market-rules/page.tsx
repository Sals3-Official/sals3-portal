import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import MarketRolesExplainerPanel from '@/components/seller-center/market-rules/MarketRolesExplainerPanel';
import CategoryPricingSection from '@/components/seller-center/market-rules/pricing/CategoryPricingSection';
import FundingBufferSection from '@/components/seller-center/market-rules/pricing/FundingBufferSection';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { resolveSellerMarketCapabilities } from '@/modules/market-config/capabilities';

export const metadata: Metadata = { title: 'Market rules · Seller Center' };

/**
 * The commercial rules this account applies — all resolved for
 * `session.sellerId`, never for a market chosen by an env var or a route
 * param.
 *
 * ## Market setup is deliberately not here (owner decision 2026-08-20)
 *
 * `MarketProfileSection` and its policy-context panel used to open this page.
 * Bogs removed them: a different business model is coming for destination
 * setup, and ADR-014 puts market governance in the Admin Portal rather than
 * inside a tenant screen. The components stay in the tree, unmounted, rather
 * than deleted — the decision is that this was the wrong *place* for them,
 * not that the work was wrong.
 *
 * **Consequence to carry forward, not solved here**: `publishProduct` still
 * refuses `NO_ACTIVE_MARKET_PROFILE` when a seller has no destination, and
 * this page was the only surface that could create one. Until the replacement
 * exists, a seller with no profile has no path to a first publication.
 * `seller_market_profiles` is untouched — the data and every backend reader
 * still work; only the way in is gone.
 *
 * ## Store default pricing is also unmounted (owner decision 2026-08-20)
 *
 * "Pang gulo lang" — per-category margin is enough for now. The card is
 * unmounted rather than deleted, and the resolver's store-default layer is
 * left in place unread: the seller had already deactivated their own row, so
 * nothing is silently pricing behind the removed screen. Re-mounting one
 * component brings it back if the decision changes.
 *
 * ## What is left, and why the gates differ
 *
 * The roles panel, then pricing (ADR-015 Phase 1). Pricing is gated by
 * `pricing_policy:read` independently of `market_rules:read` — staff and
 * viewer hold the latter but not the former. Having a pricing rule never
 * means a market is active, and vice versa.
 */
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The destination whose rules this render shows, taken from the URL.
 *
 * Validated against `resolveSellerMarketCapabilities()` — the same gate every
 * write path uses — rather than trusted. An unknown, lowercase, or
 * not-offered code falls back to the all-destinations rule instead of 404ing:
 * a hand-edited or stale link is an ordinary way to arrive here, and the
 * unscoped view is the honest thing to show when the asked-for scope is not
 * one this seller has.
 */
function resolveScope(
  raw: string | string[] | undefined,
  offerable: readonly string[],
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (value === undefined) return null;

  return offerable.includes(value) ? value : null;
}

export default async function MarketRulesPage({ searchParams }: PageProps) {
  const session = await requirePermission('market_rules:read');
  const { destinations } = resolveSellerMarketCapabilities();
  const offerable = destinations.map((d) => d.destinationCountryCode);
  const marketCode = resolveScope((await searchParams).destination, offerable);
  const destinationOptions = [
    { code: null, label: 'All destinations' },
    ...destinations.map((d) => ({
      code: d.destinationCountryCode,
      label: d.destinationCountryCode,
    })),
  ];

  const canReadPricing = can(session.role, 'pricing_policy:read');
  const canManagePricing = can(session.role, 'pricing_policy:manage');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Market rules"
        description="What this account is set up to sell, and the commercial rules it applies"
      />
      <MarketRolesExplainerPanel />
      {canReadPricing ? (
        <>
          <CategoryPricingSection
            marketCode={marketCode}
            destinationOptions={destinationOptions}
            sellerAccountId={session.sellerId}
            canManage={canManagePricing}
          />
          <FundingBufferSection
            sellerAccountId={session.sellerId}
            canManage={canManagePricing}
          />
        </>
      ) : null}
    </div>
  );
}
