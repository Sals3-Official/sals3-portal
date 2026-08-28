import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Label reprint history.
 *
 * Empty, and it has to be. This panel used to render a fixture of invented
 * order references and reprint events, which was tolerable while every parcel
 * beside it was labelled illustrative. The parcels are real rows now, so
 * fabricated reprints would sit next to genuine orders with nothing telling
 * them apart — a worse failure than the original, because a seller would have
 * no reason to doubt them.
 *
 * Nothing records a reprint because nothing prints: `OrdersWorkspace` answers
 * the print control with "Label printing is not configured yet." The empty
 * state names that same reason, so the two surfaces cannot disagree.
 */
export default function OrdersReprintHistoryPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reprint history</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          No labels have been printed. Label printing is not set up for this
          account.
        </p>
      </CardContent>
    </Card>
  );
}
