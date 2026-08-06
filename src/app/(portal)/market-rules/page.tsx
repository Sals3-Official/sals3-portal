import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import MarketRolesExplainerPanel from '@/components/seller-center/market-rules/MarketRolesExplainerPanel';
import MarketRulesTable from '@/components/seller-center/market-rules/MarketRulesTable';
import { requirePermission } from '@/lib/auth/session';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import { buildMarketRules } from '@/lib/seller-center/mock-data/market-rules';

export const metadata: Metadata = { title: 'Market rules · Seller Center' };

/**
 * Every rule applied to the account, traceable by scope, source, and
 * version - and the two roles that gate access to them.
 */
export default async function MarketRulesPage() {
  await requirePermission('market_rules:read');

  const market = getActiveMarket();
  const rules = buildMarketRules(market);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Market rules"
        description={`${market.name} configuration · rule set ${market.ruleVersion}`}
      />
      <MarketRulesTable rules={rules} />
      <MarketRolesExplainerPanel />
    </div>
  );
}
