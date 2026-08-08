import StatusPill from '@/components/seller-center/shared/StatusPill';
import { cn } from '@/lib/utils';
import type {
  SupplierConnectionRow,
  SupplierProviderRow,
} from '@/lib/db/schema';
import type { CandidateStatusCounts } from '@/modules/catalog/candidates/queries';
import { isWorkableConnectionStatus } from '@/modules/suppliers/repository';
import {
  CONNECTION_STATUS_TEXT,
  initialsOf,
  RECONNECTABLE_STATUSES,
} from './connection-presentation';
import ConnectCjDialog from './ConnectCjDialog';
import DisconnectCjButton from './DisconnectCjButton';

function formatTimestamp(value: Date | null): string {
  return value === null ? 'Not available' : value.toLocaleString();
}

function spineFor(
  connection: SupplierConnectionRow,
  hasEvidence: boolean,
  counts: CandidateStatusCounts,
): { title: string; detail: string } {
  switch (connection.status) {
    case 'CONNECTED':
      return hasEvidence
        ? {
            title: 'Healthy - feeding Product Sourcing normally',
            detail: `${counts.ready} Ready, ${counts.needsAttention} Needs Attention, ${counts.evaluating} Evaluating from this account.`,
          }
        : {
            title: 'Connected - no evidence captured yet',
            detail:
              'The next automated ingestion tick will pull the first evidence from this account.',
          };
    case 'DEGRADED':
      return {
        title: 'Sourcing is slower than usual',
        detail:
          connection.lastErrorCode !== null
            ? `Evidence refresh is degraded for this connection. Last error: ${connection.lastErrorCode}.`
            : 'Evidence refresh is degraded for this connection. Evidence still arrives, just later than usual.',
      };
    case 'REAUTH_REQUIRED':
      return {
        title: 'This connection needs re-authenticating',
        detail:
          'The provider rejected the stored credential. Sourcing has stopped for this account until you reconnect. Live listings and accepted orders are unaffected.',
      };
    case 'DISCONNECTED':
    case 'REVOKED':
      return {
        title:
          connection.status === 'REVOKED'
            ? 'Connection revoked'
            : 'Disconnected',
        detail:
          'Sourcing and evidence refresh are stopped for this account. Live listings stay published and accepted orders keep their purchased item exactly as it was.',
      };
    default:
      return {
        title: 'Connection pending',
        detail: 'This connection has not completed setup yet.',
      };
  }
}

type SupplierAppCardProps = {
  provider: SupplierProviderRow;
  connection: SupplierConnectionRow;
  lastSuccessfulSyncAt: Date | null;
  sourcingCounts: CandidateStatusCounts;
};

/**
 * One installed connection: identity + status, a four-cell detail strip,
 * a spine strip stating what this connection is doing to sourcing right
 * now, and the plain-language data-access list - the design's one
 * signature pattern, built from real connection/provider rows rather than
 * the design-preview fixtures under `src/components/products/catalog/`.
 */
export default function SupplierAppCard({
  provider,
  connection,
  lastSuccessfulSyncAt,
  sourcingCounts,
}: SupplierAppCardProps) {
  const status = CONNECTION_STATUS_TEXT[connection.status];
  const needsReconnect = RECONNECTABLE_STATUSES.has(connection.status);
  const spine = spineFor(
    connection,
    lastSuccessfulSyncAt !== null,
    sourcingCounts,
  );
  const scopes = [
    provider.capabilities.catalog && 'Read the supplier product catalogue',
    provider.capabilities.inventory && 'Read stock levels',
    provider.capabilities.productWebhooks &&
      'Receive product update notifications from the supplier',
    provider.capabilities.orderSubmission &&
      'Submit orders to the supplier on your behalf',
    provider.capabilities.orderWebhooks &&
      'Receive order status updates from the supplier',
  ].filter((scope): scope is string => Boolean(scope));

  return (
    <article
      className={cn(
        'overflow-hidden rounded-lg border border-border border-l-[3px] bg-card',
        status.edgeClassName,
      )}
    >
      <div className="flex flex-wrap items-start gap-3.5 p-4">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-sidebar text-[13px] font-semibold text-sidebar-foreground"
        >
          {initialsOf(provider.displayName)}
        </span>
        <div className="min-w-60 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-[15px] font-semibold">
              {provider.displayName}
            </h3>
            <StatusPill label={status.label} tone={status.tone} />
          </div>
          <p className="mt-1 max-w-prose text-[12.5px] text-muted-foreground">
            {connection.displayName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {needsReconnect ? (
            <ConnectCjDialog
              mode="reconnect"
              triggerLabel="Reconnect"
              triggerVariant="default"
            />
          ) : (
            <DisconnectCjButton />
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] border-t border-border">
        <div className="border-r border-muted p-3 last:border-r-0">
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Connection name
          </dt>
          <dd className="mt-1 text-[12.5px] font-medium">
            {connection.displayName}
          </dd>
        </div>
        <div className="border-r border-muted p-3 last:border-r-0">
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Provider account
          </dt>
          <dd className="mt-1 font-mono text-[12.5px]">
            {connection.externalAccountMasked}
          </dd>
        </div>
        <div className="border-r border-muted p-3 last:border-r-0">
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Last verified
          </dt>
          <dd
            className={cn(
              'mt-1 text-[12.5px] tabular-nums',
              connection.status === 'REAUTH_REQUIRED' && 'text-red-600',
            )}
          >
            {formatTimestamp(connection.lastVerifiedAt)}
          </dd>
        </div>
        <div className="p-3">
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Last successful sync
          </dt>
          <dd className="mt-1 text-[12.5px] tabular-nums">
            {formatTimestamp(lastSuccessfulSyncAt)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3.5 border-t border-border bg-muted/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold">{spine.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{spine.detail}</p>
        </div>
        <p className="text-xs text-ink-muted">
          {isWorkableConnectionStatus(connection.status)
            ? 'Usable as an active catalogue filter'
            : 'Not usable as an active catalogue filter'}
        </p>
      </div>

      {scopes.length > 0 ? (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            What this app can do with your account
          </p>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-x-5 gap-y-1.5">
            {scopes.map((scope) => (
              <li
                key={scope}
                className="flex items-start gap-1.5 text-xs text-ink-muted"
              >
                <span aria-hidden="true" className="mt-0.5 text-teal-500">
                  ✓
                </span>
                {scope}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
