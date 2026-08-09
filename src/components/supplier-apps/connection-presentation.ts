import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type { SupplierConnectionRow } from '@/lib/db/schema';

/**
 * Shared presentation for a real `SupplierConnectionRow['status']` - used by
 * both the Supplier Apps card and Overview's connection-health summary, so
 * the two surfaces can never describe the same connection two different
 * ways.
 */
export const CONNECTION_STATUS_TEXT: Record<
  SupplierConnectionRow['status'],
  { label: string; tone: StatusPillTone; edgeClassName: string }
> = {
  CONNECTED: {
    label: 'Connected',
    tone: 'success',
    edgeClassName: 'border-l-green-600',
  },
  DEGRADED: {
    label: 'Degraded',
    tone: 'warning',
    edgeClassName: 'border-l-amber-600',
  },
  REAUTH_REQUIRED: {
    label: 'Needs reconnection',
    tone: 'warning',
    edgeClassName: 'border-l-amber-600',
  },
  PENDING: {
    label: 'Pending',
    tone: 'neutral',
    edgeClassName: 'border-l-border',
  },
  DISCONNECTED: {
    label: 'Disconnected',
    tone: 'danger',
    edgeClassName: 'border-l-red-600',
  },
  REVOKED: {
    label: 'Revoked',
    tone: 'danger',
    edgeClassName: 'border-l-red-600',
  },
};

/** A connection in one of these statuses is not actively sourcing - it gets Reconnect instead of Disconnect. */
export const RECONNECTABLE_STATUSES = new Set<SupplierConnectionRow['status']>([
  'DISCONNECTED',
  'REVOKED',
  'REAUTH_REQUIRED',
]);

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
}
