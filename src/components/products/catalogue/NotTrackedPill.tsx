import { Info } from 'lucide-react';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  NOT_TRACKED_EXPLANATIONS,
  NOT_TRACKED_LABEL,
  type Tracked,
} from '@/lib/seller-center/product-catalogue/view';

type NotTrackedPillProps = {
  /** The non-`value` arm of a `Tracked<T>`; the caller has already narrowed it. */
  tracked: Exclude<Tracked<unknown>, { kind: 'value' }>;
};

/**
 * The single rendering of "we do not record this" and "this is genuinely
 * empty", so five badges share one copy of the tooltip mechanics.
 *
 * The two arms look different on purpose. A `not-tracked` dimension carries the
 * `Info` affordance and an explanation naming the missing machinery - a
 * reviewer must be able to tell it apart from a real observed absence, which
 * prints its own plain label and needs no explanation.
 */
export default function NotTrackedPill({ tracked }: NotTrackedPillProps) {
  if (tracked.kind === 'absent') {
    return <span className="text-sm text-ink-muted">{tracked.label}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill label={NOT_TRACKED_LABEL} tone="neutral" />
            <Info
              aria-label={`Why "${NOT_TRACKED_LABEL}"`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>
        {NOT_TRACKED_EXPLANATIONS[tracked.reason]}
      </TooltipContent>
    </Tooltip>
  );
}
