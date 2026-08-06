import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { AuditEntry } from '@/lib/seller-center/mock-data/inventory';

type InventoryAuditTrailPanelProps = {
  entries: AuditEntry[];
};

/**
 * Who changed what, and when. Every stepper edit appends here - nothing
 * changes silently.
 */
export default function InventoryAuditTrailPanel({
  entries,
}: InventoryAuditTrailPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record of changes</CardTitle>
        <CardDescription>
          Who made the change, the old and new value, and when.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border rounded-md border border-border">
        {entries.map((entry) => (
          <div key={entry.id} className="px-3 py-2.5">
            <p className="text-sm text-ink-muted">{entry.text}</p>
            <p className="mt-1 text-xs text-muted-foreground">{entry.meta}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
