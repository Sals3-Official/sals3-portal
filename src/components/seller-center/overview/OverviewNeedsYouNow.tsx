import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import OverviewNotYetAvailable from './OverviewNotYetAvailable';

/**
 * "Needs you now" (order exceptions, oversell risk, missed cutoffs) needs a
 * real orders and inventory backend, which does not exist yet - see
 * `hot.md`'s "Incomplete or placeholder" list. Nothing here is invented.
 */
export default function OverviewNeedsYouNow() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs you now</CardTitle>
        <CardDescription>
          What a seller must act on, separate from anything optional.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OverviewNotYetAvailable>
          Needs the orders and inventory backend - not built yet. Order
          exceptions, cutoffs and oversell risk will surface here once that
          exists.
        </OverviewNotYetAvailable>
      </CardContent>
    </Card>
  );
}
