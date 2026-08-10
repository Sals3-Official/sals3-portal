import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import PayoutDestinationPanel from '@/components/seller-center/payouts/PayoutDestinationPanel';
import PayoutScheduleChooser from '@/components/seller-center/payouts/PayoutScheduleChooser';
import PayoutStatesList from '@/components/seller-center/payouts/PayoutStatesList';
import MarketNotConfiguredNotice from '@/components/seller-center/shared/MarketNotConfiguredNotice';
import { requirePermission } from '@/lib/auth/session';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import { buildScheduleOptions } from '@/lib/seller-center/mock-data/payouts';

export const metadata: Metadata = { title: 'Payouts · Seller Center' };

/**
 * Payout schedule, states, and destination for the active market. A thin
 * Server Component composing independently-built panels.
 */
export default async function PayoutsPage() {
  await requirePermission('payout:read');

  const market = getActiveMarket();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Payouts"
        description={
          market === null
            ? 'Schedule, destination, and settlement states'
            : `Schedule, destination, and settlement states for ${market.name}`
        }
      />
      {market === null ? (
        <MarketNotConfiguredNotice />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-4">
            <PayoutScheduleChooser
              options={buildScheduleOptions(market)}
              marketName={market.name}
            />
            <PayoutStatesList market={market} />
          </div>
          <PayoutDestinationPanel market={market} />
        </div>
      )}
    </div>
  );
}
