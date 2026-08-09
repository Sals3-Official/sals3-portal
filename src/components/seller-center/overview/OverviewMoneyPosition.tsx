import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import OverviewNotYetAvailable from './OverviewNotYetAvailable';

/**
 * Two rails that must never total together (the design's own rule): Rail A
 * is customer pays Sals3 → Sals3 records commission → seller payout. Rail B
 * is the seller funding their own supplier account - a supplier wallet
 * balance is never seller revenue. Neither has a real backend yet (no
 * payment/commission system; CJ's own wallet-balance endpoint exists per
 * `hot.md`'s verified facts but nothing in this codebase calls it), so this
 * shows what the two rails mean rather than a number for either.
 */
export default function OverviewMoneyPosition() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Money position</CardTitle>
        <CardDescription>
          Two separate rails. They never net against each other.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Rail A · Customer pays Sals3 → Sals3 pays you
          </p>
          <div className="mt-2">
            <OverviewNotYetAvailable>
              Needs a payment and commission backend - not built yet.
            </OverviewNotYetAvailable>
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Rail B · You pay the supplier, from your own account
          </p>
          <div className="mt-2">
            <OverviewNotYetAvailable>
              Needs a wallet-balance integration - not built yet. A supplier
              wallet balance will never count as Sals3 revenue.
            </OverviewNotYetAvailable>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
