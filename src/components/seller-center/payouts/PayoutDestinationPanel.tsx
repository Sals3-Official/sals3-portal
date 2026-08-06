import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import { formatMarketMoney } from '@/lib/seller-center/money';
import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import PayoutDestinationChangeDialog from './PayoutDestinationChangeDialog';

type PayoutDestinationPanelProps = {
  market: SellerCenterMarket;
};

export default function PayoutDestinationPanel({
  market,
}: PayoutDestinationPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Destination</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <p className="text-sm font-semibold">{market.payoutRail}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {market.payoutRailMask} · {market.currency}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            Verified {market.payoutVerifiedDate}. Payout threshold{' '}
            {formatMarketMoney(market.payoutThresholdMinor, market)}.
          </p>
        </div>
        <PayoutDestinationChangeDialog />
        <DisclosureBanner tone="warning">
          Changing your destination is not routine friction - it protects your
          money.
        </DisclosureBanner>
      </CardContent>
    </Card>
  );
}
