import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import MarketRolesExplainerPanel from '@/components/seller-center/market-rules/MarketRolesExplainerPanel';
import MarketRulesTable from '@/components/seller-center/market-rules/MarketRulesTable';
import CategoryPricingSection from '@/components/seller-center/market-rules/pricing/CategoryPricingSection';
import FxAdjustmentSection from '@/components/seller-center/market-rules/pricing/FxAdjustmentSection';
import MarketNotConfiguredNotice from '@/components/seller-center/shared/MarketNotConfiguredNotice';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import { buildMarketRules } from '@/lib/seller-center/mock-data/market-rules';

export const metadata: Metadata = { title: 'Market rules · Seller Center' };

/**
 * Every rule applied to the account, traceable by scope, source, and
 * version - and the two roles that gate access to them.
 *
 * Category pricing and FX adjustment (ADR-015 Phase 1) sit below the
 * existing market rules rather than as a new top-level nav item. They are
 * gated by `pricing_policy:read` independently of `market_rules:read` —
 * staff/viewer hold the latter but not the former, the same split this
 * codebase already applies to `finance:read`.
 */
export default async function MarketRulesPage() {
  const session = await requirePermission('market_rules:read');

  const market = getActiveMarket();
  const canReadPricing = can(session.role, 'pricing_policy:read');
  const canManagePricing = can(session.role, 'pricing_policy:manage');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Market rules"
        description={
          market === null
            ? 'Account configuration'
            : `${market.name} configuration · rule set ${market.ruleVersion}`
        }
      />
      {market === null ? (
        <MarketNotConfiguredNotice />
      ) : (
        <>
          <MarketRulesTable rules={buildMarketRules(market)} />
          <MarketRolesExplainerPanel />
        </>
      )}
      {canReadPricing ? (
        <>
          <CategoryPricingSection
            sellerAccountId={session.sellerId}
            canManage={canManagePricing}
          />
          <FxAdjustmentSection
            sellerAccountId={session.sellerId}
            canManage={canManagePricing}
          />
        </>
      ) : null}
    </div>
  );
}
