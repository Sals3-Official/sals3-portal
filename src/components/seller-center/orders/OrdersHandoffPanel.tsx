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
          Carrier and cutoff details are not configured for this account yet.
          Pickup cannot be suggested or booked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold">
              Handoff setup is outstanding
            </p>
            <p className="text-xs text-muted-foreground">
              Configure a carrier and cutoff before arranging pickup.
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
