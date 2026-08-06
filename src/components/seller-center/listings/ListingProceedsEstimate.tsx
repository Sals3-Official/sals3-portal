import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import { formatSignedMarketMoney } from '@/lib/seller-center/money';
import { ESTIMATE_NOT_PROFIT_NOTE } from '@/lib/seller-center/disclosures';
import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import type { ProceedsLine } from '@/lib/seller-center/mock-data/listings';

type ListingProceedsEstimateProps = {
  market: SellerCenterMarket;
  lines: ProceedsLine[];
  totalMinor: number;
};

export default function ListingProceedsEstimate({
  market,
  lines,
  totalMinor,
}: ListingProceedsEstimateProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimated proceeds</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 text-sm">
          {lines.map((line) => (
            <div
              key={line.label}
              className={`flex justify-between gap-3 ${
                line.amountMinor < 0 ? 'text-ink-muted' : 'text-foreground'
              }`}
            >
              <span>{line.label}</span>
              <span className="tabular-nums">
                {formatSignedMarketMoney(line.amountMinor, market)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold">Estimated</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatSignedMarketMoney(totalMinor, market)}
          </span>
        </div>
        <DisclosureBanner tone="warning">
          {ESTIMATE_NOT_PROFIT_NOTE}
        </DisclosureBanner>
      </CardContent>
    </Card>
  );
}
