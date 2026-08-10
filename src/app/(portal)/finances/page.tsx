import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import FinancesLedgerPanel from '@/components/seller-center/finances/FinancesLedgerPanel';
import FinancesNotIncludedPanel from '@/components/seller-center/finances/FinancesNotIncludedPanel';
import FinancesVariancePanel from '@/components/seller-center/finances/FinancesVariancePanel';
import MarketNotConfiguredNotice from '@/components/seller-center/shared/MarketNotConfiguredNotice';
import { requirePermission } from '@/lib/auth/session';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import { DEFAULT_LEDGER_ORDER_ID } from '@/lib/seller-center/mock-data/finances';

export const metadata: Metadata = { title: 'Finances · Seller Center' };

/**
 * Itemized ledger and estimated seller proceeds for one order. A thin
 * Server Component composing independently-built, fully static panels -
 * no interactivity is needed on this screen.
 */
export default async function FinancesPage() {
  await requirePermission('finance:read');

  const market = getActiveMarket();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Finances"
        description="Itemized ledger and estimated seller proceeds"
      />
      {market === null ? (
        <MarketNotConfiguredNotice />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <FinancesLedgerPanel
            orderId={DEFAULT_LEDGER_ORDER_ID}
            market={market}
          />
          <div className="flex flex-col gap-4">
            <FinancesVariancePanel />
            <FinancesNotIncludedPanel />
          </div>
        </div>
      )}
    </div>
  );
}
