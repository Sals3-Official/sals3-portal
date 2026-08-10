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
  SUPPLIER_CONNECTION_HEALTH_LABELS,
  type SupplierConnectionHealth,
} from '@/lib/seller-center/product-catalogue/types';

type SupplierConnectionHealthBadgeProps = {
  health: SupplierConnectionHealth;
};

const TONE_BY_HEALTH: Record<SupplierConnectionHealth, StatusPillTone> = {
  CONNECTED: 'success',
  DEGRADED: 'warning',
  DISCONNECTED: 'danger',
};

/**
 * ADR-013 §5's recoverable connection health - the supplier connection's
 * own state, never derived from (or collapsed into) a product's
 * `Availability`. `DEGRADED` is deliberately generic: reauthorization is
 * only one possible cause among several recoverable ones (CJ points
 * exhaustion, inactivity suspension), so the label and this fallback
 * explanation never name reauth specifically unless a future evidence
 * field states that is the actual known reason.
 */
const TIP_BY_HEALTH: Record<SupplierConnectionHealth, string> = {
  CONNECTED:
    'The supplier connection is healthy and can refresh evidence on request.',
  DEGRADED:
    'The supplier connection is temporarily degraded - for example, reauthorization pending, CJ points exhaustion, or inactivity suspension. Fresh checks are paused until it recovers; last trusted evidence for this listing is unaffected.',
  DISCONNECTED:
    'The supplier connection is disconnected. Reconnect in Supplier Apps to resume evaluation.',
};

export default function SupplierConnectionHealthBadge({
  health,
}: SupplierConnectionHealthBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill
              label={SUPPLIER_CONNECTION_HEALTH_LABELS[health]}
              tone={TONE_BY_HEALTH[health]}
            />
            <Info
              aria-label={`What "${SUPPLIER_CONNECTION_HEALTH_LABELS[health]}" means`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>{TIP_BY_HEALTH[health]}</TooltipContent>
    </Tooltip>
  );
}
