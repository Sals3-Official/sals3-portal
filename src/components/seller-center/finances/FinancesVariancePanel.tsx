import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  VARIANCE_MEDIAN_PCT,
  VARIANCE_REASONS,
  VARIANCE_SAMPLE_NOTE,
} from '@/lib/seller-center/mock-data/finances';

/**
 * How far the estimate typically lands from the final settled amount, and
 * why - CSS bar meters, no chart library, per this project's design
 * system.
 */
export default function FinancesVariancePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimate to final variance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-2xl font-semibold tabular-nums">
            {VARIANCE_MEDIAN_PCT}%
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {VARIANCE_SAMPLE_NOTE}
          </p>
        </div>
        <div className="flex flex-col gap-2.5">
          {VARIANCE_REASONS.map((reason) => (
            <div key={reason.id}>
              <div className="mb-1 flex justify-between gap-2 text-sm">
                <span className="text-ink-muted">{reason.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {reason.sharePct}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${reason.sharePct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
