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
import type { Tracked } from '@/lib/seller-center/product-catalogue/view';
import NotTrackedPill from './NotTrackedPill';

type SupplierConnectionHealthBadgeProps = {
  health: Tracked<SupplierConnectionHealth>;
};

const TONE_BY_HEALTH: Record<SupplierConnectionHealth, StatusPillTone> = {
  PENDING: 'neutral',
  CONNECTED: 'success',
  DEGRADED: 'warning',
  REAUTH_REQUIRED: 'warning',
  DISCONNECTED: 'danger',
  REVOKED: 'danger',
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
  PENDING:
    'The connection has been created but has never completed a successful supplier call, so no evidence can be refreshed through it yet.',
  REAUTH_REQUIRED:
    'The supplier revoked or expired this connection’s authorization. Reauthorize it in Supplier Apps - unlike a generic degradation, this one has a specific action.',
  REVOKED:
    'This connection was revoked and will not recover on its own. A new connection must be created in Supplier Apps.',
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
  if (health.kind !== 'value') return <NotTrackedPill tracked={health} />;

  const state = health.value;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill
              label={SUPPLIER_CONNECTION_HEALTH_LABELS[state]}
              tone={TONE_BY_HEALTH[state]}
            />
            <Info
              aria-label={`What "${SUPPLIER_CONNECTION_HEALTH_LABELS[state]}" means`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>{TIP_BY_HEALTH[state]}</TooltipContent>
    </Tooltip>
  );
}
