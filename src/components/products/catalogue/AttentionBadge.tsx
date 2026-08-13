import { Info } from 'lucide-react';
import StatusPill, {
  type StatusPillTone,
} from '@/components/seller-center/shared/StatusPill';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { worstAttentionSeverity } from '@/lib/seller-center/product-catalogue/derive';
import {
  ATTENTION_SEVERITY_LABELS,
  type AttentionReasonFixture,
  type AttentionSeverity,
} from '@/lib/seller-center/product-catalogue/types';
import type { Tracked } from '@/lib/seller-center/product-catalogue/view';
import NotTrackedPill from './NotTrackedPill';

type AttentionBadgeProps = {
  reasons: Tracked<AttentionReasonFixture[]>;
};

const TONE_BY_SEVERITY: Record<AttentionSeverity, StatusPillTone> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'neutral',
};

/**
 * Shows the count and worst severity of unresolved attention, matching
 * ADR-007's canonical `AttentionIssue` model - never a bare count with no
 * severity, and never silent when checkout is currently blocked for the
 * affected scope.
 */
export default function AttentionBadge({ reasons }: AttentionBadgeProps) {
  // The "Clear" arm below MUST stay behind the `value` check: printing
  // "Clear" for a dimension nothing measures is exactly the fabricated
  // all-good signal this whole view model exists to prevent.
  if (reasons.kind !== 'value') return <NotTrackedPill tracked={reasons} />;

  const list = reasons.value;

  if (list.length === 0) {
    return <StatusPill label="Clear" tone="success" />;
  }

  const worst = worstAttentionSeverity(list);

  if (worst === null) return <StatusPill label="Clear" tone="success" />;

  const label = `${ATTENTION_SEVERITY_LABELS[worst]} (${list.length})`;
  const blocksCheckout = list.some((reason) => !reason.checkoutAllowed);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill label={label} tone={TONE_BY_SEVERITY[worst]} />
            <Info
              aria-label={`${list.length} open attention ${list.length === 1 ? 'issue' : 'issues'}, worst severity ${ATTENTION_SEVERITY_LABELS[worst]}`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>
        <ul className="m-0 list-disc pl-4">
          {list.map((reason) => (
            <li key={reason.id}>{reason.summary}</li>
          ))}
        </ul>
        {blocksCheckout ? (
          <p className="mt-1 font-medium">New checkout is currently blocked.</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
