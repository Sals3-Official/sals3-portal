import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  RotateCw,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SupplierConnectionStatus } from '@/lib/products/catalog-types';
import { CONNECTION_STATUS_TEXT } from '@/lib/products/catalog-presentation';

type SupplierConnectionHealthProps = {
  status: SupplierConnectionStatus;
};

const ICON: Record<SupplierConnectionStatus, typeof CheckCircle2> = {
  CONNECTED: CheckCircle2,
  DEGRADED: AlertTriangle,
  REAUTH_REQUIRED: RotateCw,
  PENDING: Clock,
  DISCONNECTED: Ban,
  REVOKED: Ban,
};

const TONE_TEXT_CLASS: Record<SupplierConnectionStatus, string> = {
  CONNECTED: 'text-green-600',
  DEGRADED: 'text-amber-600',
  REAUTH_REQUIRED: 'text-amber-600',
  PENDING: 'text-ink-faint',
  DISCONNECTED: 'text-red-600',
  REVOKED: 'text-red-600',
};

/**
 * A small icon-only health indicator next to a supplier's name - CONNECTED
 * stays visually quiet (no reason to draw the eye to a healthy connection on
 * every row), everything else gets a coloured icon plus a text tooltip.
 * Tooltip content also reaches keyboard focus (Base UI's tooltip trigger is
 * a real focusable element), so the state is never hover-only.
 */
export default function SupplierConnectionHealth({
  status,
}: SupplierConnectionHealthProps) {
  const Icon = ICON[status];
  const { label } = CONNECTION_STATUS_TEXT[status];

  if (status === 'CONNECTED') {
    return <span className="sr-only">{label}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" className="inline-flex" aria-label={label}>
            <Icon
              aria-hidden="true"
              className={cn('size-3.5', TONE_TEXT_CLASS[status])}
            />
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
