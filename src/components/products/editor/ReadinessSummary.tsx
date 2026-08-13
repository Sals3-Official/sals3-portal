import { formatDateTime } from '@/lib/seller-center/product-editor/format';
import type { IssueSeverity } from '@/lib/seller-center/product-editor/types';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { SEVERITY_PRESENTATION } from './presentation';

type ReadinessSummaryProps = {
  blockerCount: number;
  warningCount: number;
  suggestionCount: number;
  /**
   * When the check behind these counts ran. `null` means it ran as part of THIS
   * render - the real editor derives its requirements from the product's own
   * rows on every load, so there is no stored validation timestamp to quote,
   * and printing one would date a check that never happened separately.
   */
  lastValidatedAt: string | null;
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
 * What is in the way, by severity, and when that was last established.
 *
 * Overall status and completion moved up into `ReadinessStatusHeader`, above
 * the tab strip, because they describe the listing rather than this tab. What
 * remains is the breakdown the issue list immediately below expands on, so
 * the two read as one block instead of two competing cards - the previous
 * `border-t` above the chips is gone for that reason.
 */
export default function ReadinessSummary({
  blockerCount,
  warningCount,
  suggestionCount,
  lastValidatedAt,
}: ReadinessSummaryProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <CountChip severity="BLOCKER" value={blockerCount} />
        <CountChip severity="WARNING" value={warningCount} />
        <CountChip severity="SUGGESTION" value={suggestionCount} />
      </div>

      {/*
        Supporting metadata, subdued by size and weight rather than by a
        lighter ink: `text-ink-faint` (#8a9196) would read as more clearly
        secondary but lands on 3.20:1 against the card, under the 4.5:1 AA
        floor. `text-muted-foreground` clears it at 5.85:1.
      */}
      <p className="text-xs text-muted-foreground">
        {lastValidatedAt === null
          ? 'Checked as this page loaded, from this product\u2019s own records'
          : `Last automated check ${formatDateTime(lastValidatedAt)}`}
      </p>
    </div>
  );
}
