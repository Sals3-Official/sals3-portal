import presentEvaluationStatus from '@/components/products/cj/evaluation-status';
import { Progress } from '@/components/ui/progress';
import { formatDateTime } from '@/lib/seller-center/product-editor/format';
import type { EvaluationStatus } from '@/modules/catalog/candidates/rules/contracts';
import StatusPill from '@/components/seller-center/shared/StatusPill';

type ReadinessSummaryProps = {
  status: EvaluationStatus;
  completionPercent: number;
  blockerCount: number;
  warningCount: number;
  suggestionCount: number;
  lastValidatedAt: string;
};

type CountRowProps = {
  label: string;
  value: number;
  emphasis?: 'danger' | 'warning';
};

/**
 * Sharing one grid across all three rows (rather than each row running its
 * own `justify-between`) is what actually guarantees the value column lines
 * up - three independent flex rows only look aligned by coincidence, the
 * moment any of them changes width.
 */
function CountRow({ label, value, emphasis }: CountRowProps) {
  const emphasised = value > 0 && emphasis !== undefined;
  const toneClass = emphasis === 'danger' ? 'text-red-600' : 'text-amber-600';

  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd
        className={`text-right font-semibold tabular-nums ${emphasised ? toneClass : 'text-ink-muted'}`}
      >
        {value}
      </dd>
    </>
  );
}

/**
 * The one-glance answer to "can I publish this, and what is in my way".
 *
 * The status label is `presentEvaluationStatus`, the same wording the
 * sourcing tables and the evaluation drawer already use - the editor does
 * not invent a second vocabulary for the same seven decision states.
 */
export default function ReadinessSummary({
  status,
  completionPercent,
  blockerCount,
  warningCount,
  suggestionCount,
  lastValidatedAt,
}: ReadinessSummaryProps) {
  const presentation = presentEvaluationStatus(status);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={presentation.label} tone={presentation.tone} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {completionPercent}% complete
        </span>
      </div>

      <Progress value={completionPercent} aria-label="Listing completeness" />

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 border-t border-border pt-3 text-xs">
        <CountRow label="Blockers" value={blockerCount} emphasis="danger" />
        <CountRow label="Warnings" value={warningCount} emphasis="warning" />
        <CountRow label="Suggestions" value={suggestionCount} />
      </dl>

      <p className="text-xs text-muted-foreground">
        Last automated check {formatDateTime(lastValidatedAt)}
      </p>
    </div>
  );
}
