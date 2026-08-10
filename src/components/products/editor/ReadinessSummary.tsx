import presentEvaluationStatus from '@/components/products/cj/evaluation-status';
import { Progress } from '@/components/ui/progress';
import { formatDateTime } from '@/lib/seller-center/product-editor/format';
import type { EvaluationStatus } from '@/modules/catalog/candidates/rules/contracts';
import type { IssueSeverity } from '@/lib/seller-center/product-editor/types';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { SEVERITY_PRESENTATION } from './presentation';

type ReadinessSummaryProps = {
  status: EvaluationStatus;
  completionPercent: number;
  blockerCount: number;
  warningCount: number;
  suggestionCount: number;
  lastValidatedAt: string;
};

type CountChipProps = {
  severity: IssueSeverity;
  value: number;
};

/**
 * One glanceable chip per severity instead of three `label: value` text
 * rows - the same "count first, colour second" pattern order-management
 * screens use for status filters, applied to the same `SEVERITY_PRESENTATION`
 * tokens the issue list below already uses, so this row and the list it
 * summarises can never describe severity differently. Zero renders as a
 * quiet neutral chip rather than disappearing - a missing chip would read
 * as "not checked", not "none found".
 */
function CountChip({ severity, value }: CountChipProps) {
  const presentation = SEVERITY_PRESENTATION[severity];
  const label = `${value} ${value === 1 ? presentation.label : `${presentation.label}s`}`;

  if (value === 0) {
    return <StatusPill label={label} tone="neutral" />;
  }

  return (
    <StatusPill
      label={label}
      tone={presentation.tone}
      icon={presentation.icon}
    />
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

      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        <CountChip severity="BLOCKER" value={blockerCount} />
        <CountChip severity="WARNING" value={warningCount} />
        <CountChip severity="SUGGESTION" value={suggestionCount} />
      </div>

      <p className="text-xs text-muted-foreground">
        Last automated check {formatDateTime(lastValidatedAt)}
      </p>
    </div>
  );
}
