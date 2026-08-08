import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import OverviewNotYetAvailable from './OverviewNotYetAvailable';

/**
 * ADR-007's supplier-change attention/event system (delist, price spike,
 * stock loss) isn't built yet - it's step 3 of the approved design's own
 * implementation sequence, still ahead of this page in the queue.
 */
export default function OverviewRecentSupplierChanges() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent supplier changes</CardTitle>
        <CardDescription>Current listings only.</CardDescription>
      </CardHeader>
      <CardContent>
        <OverviewNotYetAvailable>
          Needs the supplier-change attention system (ADR-007) - not built yet.
          Accepted orders are unaffected either way; their purchased item is
          always frozen.
        </OverviewNotYetAvailable>
      </CardContent>
    </Card>
  );
}
