import { Info } from 'lucide-react';
import StatusPill, {
  type StatusPillTone,
} from '@/components/seller-center/shared/StatusPill';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AVAILABILITY_LABELS,
  type Availability,
} from '@/lib/seller-center/product-catalogue/types';
import type { Tracked } from '@/lib/seller-center/product-catalogue/view';
import NotTrackedPill from './NotTrackedPill';

type AvailabilityBadgeProps = {
  availability: Tracked<Availability>;
};

const TONE_BY_AVAILABILITY: Record<Availability, StatusPillTone> = {
  AVAILABLE: 'success',
  SOME_VARIANTS_UNAVAILABLE: 'warning',
  OUT_OF_STOCK: 'danger',
  SUPPLIER_CHECK_PENDING: 'neutral',
  SUPPLIER_DISCONNECTED: 'danger',
  MARKET_UNAVAILABLE: 'warning',
  UNKNOWN_OR_STALE: 'neutral',
};

/**
 * What is actually known, not a single aggregate stock total. See
 * `nextjs-component-security-code-rules`/the handoff: the tooltip must
 * explain the real evidence state, never just "total stock across every
 * variant" - that phrasing implied a destination freight route or a
 * customer guarantee neither this preview nor the real system can prove.
 */
const TIP_BY_AVAILABILITY: Record<Availability, string> = {
  AVAILABLE: 'Every variant has current, purchasable supplier-reported stock.',
  SOME_VARIANTS_UNAVAILABLE:
    'At least one variant is unavailable while others stay purchasable. Only the affected variant is disabled.',
  OUT_OF_STOCK:
    'Every variant is unavailable. New checkout is blocked for this listing.',
  SUPPLIER_CHECK_PENDING:
    'A fresh supplier stock check has not completed yet. Last known evidence may be stale.',
  SUPPLIER_DISCONNECTED:
    'The supplier connection is not currently workable. New checkout is blocked until it reconnects and re-evaluates.',
  MARKET_UNAVAILABLE:
    'No confirmed destination freight route for an enabled market. Stock at the origin does not by itself confirm delivery.',
  UNKNOWN_OR_STALE:
    'The last supplier evidence is old enough that its current accuracy cannot be trusted.',
};

export default function AvailabilityBadge({
  availability,
}: AvailabilityBadgeProps) {
  if (availability.kind !== 'value')
    return <NotTrackedPill tracked={availability} />;

  const state = availability.value;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill
              label={AVAILABILITY_LABELS[state]}
              tone={TONE_BY_AVAILABILITY[state]}
            />
            <Info
              aria-label={`What "${AVAILABILITY_LABELS[state]}" means`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>{TIP_BY_AVAILABILITY[state]}</TooltipContent>
    </Tooltip>
  );
}
