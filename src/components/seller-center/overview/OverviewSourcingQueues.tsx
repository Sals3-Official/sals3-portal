import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import formatRelativeDuration from '@/lib/format/relative-duration';
import { cn } from '@/lib/utils';
import type { CandidateStatusCounts } from '@/modules/catalog/candidates/queries';

type QueueRow = {
  label: string;
  href: string;
  count: number;
  oldestAgeMs: number | null;
  todo: string;
  emphasis: 'neutral' | 'warning' | 'danger';
};

const EMPHASIS_CLASS: Record<QueueRow['emphasis'], string> = {
  neutral: 'text-foreground',
  warning: 'text-amber-600',
  danger: 'text-red-600',
};

function oldestWaitingLabel(row: QueueRow): string {
  if (row.count === 0) return '—';
  if (row.oldestAgeMs === null) return 'Not available';
  return formatRelativeDuration(row.oldestAgeMs);
}

type OverviewSourcingQueuesProps = {
  counts: CandidateStatusCounts;
  oldestReadyAgeMs: number | null;
  oldestNeedsAttentionAgeMs: number | null;
  oldestEvaluatingAgeMs: number | null;
  oldestBlockedRejectedAgeMs: number | null;
  oldestExceptionAgeMs: number | null;
};

/**
 * The real automated-evaluation-pipeline counts, the same query already
 * built for the nav rail's badges (`countCandidateStatusSummary`) - one row
 * per queue a seller can act on, oldest-waiting first for the ones that
 * actually need a person.
 */
export default function OverviewSourcingQueues({
  counts,
  oldestReadyAgeMs,
  oldestNeedsAttentionAgeMs,
  oldestEvaluatingAgeMs,
  oldestBlockedRejectedAgeMs,
  oldestExceptionAgeMs,
}: OverviewSourcingQueuesProps) {
  const rows: QueueRow[] = [
    {
      label: 'Ready',
      href: '/products/qualified/ready',
      count: counts.ready,
      oldestAgeMs: oldestReadyAgeMs,
      todo: 'Customize and list when ready.',
      emphasis: 'neutral',
    },
    {
      label: 'Needs Attention',
      href: '/products/qualified/needs-attention',
      count: counts.needsAttention,
      oldestAgeMs: oldestNeedsAttentionAgeMs,
      todo: 'Read the warning, then customize and list.',
      emphasis: counts.needsAttention > 0 ? 'warning' : 'neutral',
    },
    {
      label: 'Evaluating',
      href: '/products/evaluating',
      count: counts.evaluating,
      oldestAgeMs: oldestEvaluatingAgeMs,
      todo: 'Nothing to do - clears on its own.',
      emphasis: 'neutral',
    },
    {
      label: 'Blocked / Rejected',
      href: '/products/blocked',
      count: counts.blockedRejected,
      oldestAgeMs: oldestBlockedRejectedAgeMs,
      todo: 'Temporary ones retry on their own; permanent ones need no action.',
      emphasis: 'neutral',
    },
    {
      label: 'Exception Queue',
      href: '/products/exception-queue',
      count: counts.exceptionQueue,
      oldestAgeMs: oldestExceptionAgeMs,
      todo: 'Needs a person to review the failure.',
      emphasis: counts.exceptionQueue > 0 ? 'danger' : 'neutral',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product Sourcing queues</CardTitle>
        <CardDescription>
          Live counts from the automated evaluation pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-medium text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-left font-medium">
                Queue
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Candidates
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Oldest waiting
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium">
                What to do
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-2.5">
                  <Link
                    href={row.href}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {row.label}
                  </Link>
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-right font-semibold tabular-nums',
                    EMPHASIS_CLASS[row.emphasis],
                  )}
                >
                  {row.count}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                  {oldestWaitingLabel(row)}
                </td>
                <td className="px-4 py-2.5 text-xs text-ink-muted">
                  {row.todo}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
