import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { OVERVIEW_GLANCE_STATS } from '@/lib/seller-center/mock-data/overview';

const VALUE_TONE_CLASS = {
  neutral: 'text-foreground',
  success: 'text-green-600',
  warning: 'text-amber-600',
  danger: 'text-red-600',
} as const;

/**
 * Counts with meaning, not raw pending numbers - each row states what a
 * good and a bad value looks like through colour plus the label text.
 */
export default function OverviewTodayAtAGlance() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today at a glance</CardTitle>
        <CardDescription>
          Counts with meaning, not raw pending numbers.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border rounded-md border border-border">
        {OVERVIEW_GLANCE_STATS.map((stat) => (
          <div
            key={stat.id}
            className="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <p className="text-sm text-ink-muted">{stat.label}</p>
            <p
              className={`text-sm font-semibold tabular-nums ${VALUE_TONE_CLASS[stat.tone]}`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
