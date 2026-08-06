import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { formatSignedMarketMoney } from '@/lib/seller-center/money';
import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import {
  buildLedgerLines,
  DEFAULT_SETTLEMENT_DATE,
} from '@/lib/seller-center/mock-data/finances';

type FinancesLedgerPanelProps = {
  orderId: string;
  market: SellerCenterMarket;
};

/**
 * Itemized ledger for one order. Every amount maps to a line item and a
 * rule version - never one collapsed number.
 */
export default function FinancesLedgerPanel({
  orderId,
  market,
}: FinancesLedgerPanelProps) {
  const lines = buildLedgerLines(market);
  const totalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Order {orderId} — itemized ledger</CardTitle>
          <StatusPill label="Pending" tone="info" />
        </div>
        <CardDescription>
          Every amount maps to a line item and a rule version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col divide-y divide-border">
          {lines.map((line) => (
            <div
              key={line.label}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div>
                <p
                  className={
                    line.emphasis
                      ? 'text-sm font-semibold text-foreground'
                      : 'text-sm text-ink-muted'
                  }
                >
                  {line.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {line.ruleRef}
                </p>
              </div>
              <p
                className={
                  line.emphasis
                    ? 'text-sm font-semibold tabular-nums'
                    : 'text-sm tabular-nums text-ink-muted'
                }
              >
                {formatSignedMarketMoney(line.amountMinor, market)}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t-2 border-foreground pt-3">
          <div>
            <p className="text-sm font-bold">Estimated seller proceeds</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Final on settlement {DEFAULT_SETTLEMENT_DATE}
            </p>
          </div>
          <p className="text-xl font-bold tabular-nums">
            {formatSignedMarketMoney(totalMinor, market)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
