import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { formatMarketMoney } from '@/lib/seller-center/money';
import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import { PAYOUT_STATES } from '@/lib/seller-center/mock-data/payouts';
import { TRACE_ID_GLOSS } from '@/lib/seller-center/disclosures';

type PayoutStatesListProps = {
  market: SellerCenterMarket;
};

export default function PayoutStatesList({ market }: PayoutStatesListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout states</CardTitle>
        <CardDescription>Each trace ID is {TRACE_ID_GLOSS}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {PAYOUT_STATES.map((payout) => (
          <div
            key={payout.id}
            className="grid grid-cols-2 items-center gap-2 py-2.5 sm:grid-cols-[110px_1fr_1fr_auto]"
          >
            <StatusPill label={payout.state} tone={payout.tone} />
            <p className="text-sm font-semibold tabular-nums">
              {formatMarketMoney(payout.amountMinor, market)}
            </p>
            <p className="col-span-2 text-sm text-ink-muted sm:col-span-1">
              {payout.note}
            </p>
            <p className="col-span-2 text-right text-xs text-muted-foreground sm:col-span-1">
              {payout.traceId}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
