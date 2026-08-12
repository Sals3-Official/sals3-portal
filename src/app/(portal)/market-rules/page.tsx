import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import MarketRolesExplainerPanel from '@/components/seller-center/market-rules/MarketRolesExplainerPanel';
import MarketProfileSection from '@/components/seller-center/market-rules/profile/MarketProfileSection';
import CategoryPricingSection from '@/components/seller-center/market-rules/pricing/CategoryPricingSection';
import FundingBufferSection from '@/components/seller-center/market-rules/pricing/FundingBufferSection';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Market rules · Seller Center' };

/**
 * What this account is actually configured for, and the commercial rules it
 * applies — all resolved for `session.sellerId`, never for a market chosen by
 * an env var or a route param.
 *
 * This page no longer reads `lib/seller-center/market-config.ts`. That
 * fixture's PH/ID/SG markets, and the commission/tax/carrier/payout rows
 * `buildMarketRules()` derived from them, are interface-review examples; in
 * production `getActiveMarket()` returned `null` and the whole screen
 * degraded to a generic "not available" notice that told a signed-in seller
 * nothing about their own account. `MarketProfileSection` reads the real
 * persisted profile instead and states honestly what is and is not set up.
 *
 * Three separate concerns, in order, and deliberately not merged: the
 * account's own market setup; the roles that gate changes to it; then
 * category pricing and the funding buffer (ADR-015 Phase 1), gated by
 * `pricing_policy:read` independently of `market_rules:read` — staff and
 * viewer hold the latter but not the former. Having a pricing rule never
 * means a market is active, and vice versa.
 */
export default async function MarketRulesPage() {
  const session = await requirePermission('market_rules:read');

  const canManageProfile = can(session.role, 'market_profile:manage');
  const canReadPricing = can(session.role, 'pricing_policy:read');
  const canManagePricing = can(session.role, 'pricing_policy:manage');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Market rules"
        description="What this account is set up to sell, and the commercial rules it applies"
      />
      <MarketProfileSection
        sellerAccountId={session.sellerId}
        canManage={canManageProfile}
      />
      <MarketRolesExplainerPanel />
      {canReadPricing ? (
        <>
          <CategoryPricingSection
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
