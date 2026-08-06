import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { SellerCenterMarket } from '@/lib/seller-center/market-config';

type OrdersHandoffPanelProps = {
  market: SellerCenterMarket;
};

/**
 * Pickup is suggested, never booked automatically - a seller reviews
 * capacity and exceptions before anything is sent to the carrier.
 */
export default function OrdersHandoffPanel({
  market,
}: OrdersHandoffPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Handoff</CardTitle>
        <CardDescription>
          Pickup is suggested, never booked for you. You review it before it
          goes to {market.carrierName}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">
              Suggested pickup — today, {market.cutoffTime}
            </p>
            <p className="text-xs text-muted-foreground">
              Capacity 30 parcels · 12 booked
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Pickup review is not built yet"
            className="h-8 shrink-0 cursor-not-allowed rounded-md border border-border px-3 text-sm font-medium text-muted-foreground"
          >
            Review
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
