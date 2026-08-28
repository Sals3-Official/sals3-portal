import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
/**
 * Pickup is suggested, never booked automatically - a seller reviews
 * capacity and exceptions before anything is sent to the carrier.
 */
export default function OrdersHandoffPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Handoff</CardTitle>
        <CardDescription>
          Carrier and cut-off times are not set up for this account, so pickup
          cannot be scheduled.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">Handover setup incomplete</p>
            <p className="text-xs text-muted-foreground">
              Add a carrier and cut-off time to schedule pickup.
            </p>
          </div>
          <button
            type="button"
            disabled
            title="Pickup scheduling is not available yet"
            className="h-8 shrink-0 cursor-not-allowed rounded-md border border-border px-3 text-sm font-medium text-muted-foreground"
          >
            Review
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
