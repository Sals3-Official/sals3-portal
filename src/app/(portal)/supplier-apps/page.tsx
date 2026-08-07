import type { Metadata } from 'next';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import PageHeader from '@/components/portal/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import CjLogo from '@/components/supplier-apps/CjLogo';
import ConnectCjDialog from '@/components/supplier-apps/ConnectCjDialog';
import DisconnectCjButton from '@/components/supplier-apps/DisconnectCjButton';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
} from '@/modules/suppliers/repository';

export const metadata: Metadata = { title: 'Supplier Apps · Sals3 Portal' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<
  string,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  CONNECTED: 'success',
  DEGRADED: 'warning',
  REAUTH_REQUIRED: 'warning',
  PENDING: 'neutral',
  DISCONNECTED: 'danger',
  REVOKED: 'danger',
};

/**
 * A connection in one of these statuses is not actively sourcing, so the
 * card offers Reconnect (same server action, see `connectCjSupplier`'s
 * reconnect branch) instead of a Disconnect button.
 */
const RECONNECTABLE_STATUSES = new Set([
  'DISCONNECTED',
  'REVOKED',
  'REAUTH_REQUIRED',
]);

const RECONNECT_COPY: Record<string, string> = {
  DISCONNECTED: 'Disconnected - nothing is being sourced from this account.',
  REVOKED: 'This connection was revoked.',
  REAUTH_REQUIRED: 'CJ needs this connection re-authenticated.',
};

/**
 * Supplier Apps (ADR-008): a Dropshipper's own curated provider connections,
 * presented as an installable-app tile (today: one, CJ Dropshipping) rather
 * than a form that's always on screen - a new seller with nothing connected
 * yet gets a clear "what is this, how do I get one" pitch and a guided
 * dialog (`ConnectCjDialog`) instead of a bare API-key input.
 */
export default async function SupplierAppsPage() {
  // See Product Sourcing pages' identical comment: this must run before
  // `requireDropshipperAccount()`, which reaches the database immediately.
  if (!isDatabaseConfigured()) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Supplier Apps"
          description="Connect a supplier account"
        />
        <SourcingEmptyState
          title="No database configured in this environment"
          description="DATABASE_URL is not set here, so supplier connections cannot be read. This page works against a configured Postgres database - see the README."
        />
      </div>
    );
  }

  const { sellerAccount } = await requireDropshipperAccount();
  const provider = await findProviderByCode(getDb(), 'CJ_DROPSHIPPING');
  const connection =
    provider === null
      ? null
      : await findConnectionBySellerAndProvider(
          getDb(),
          sellerAccount.id,
          provider.id,
        );

  const needsReconnect =
    connection !== null && RECONNECTABLE_STATUSES.has(connection.status);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Supplier Apps"
        description="Connect your own supplier accounts - credentials are encrypted and never shown again"
      />

      <SourcingInfoBanner>
        Connect your own supplier account here (CJ Dropshipping today). Product
        Sourcing (Ready, Needs Attention, Evaluating, Blocked / Rejected,
        Exception Queue, All Supplier Products) only ever sources from the
        connection you set up on this screen.
      </SourcingInfoBanner>

      <Card className="max-w-xl animate-in fade-in slide-in-from-top-1 duration-300">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CjLogo />
          <StatusPill
            label={connection?.status ?? 'NOT CONNECTED'}
            tone={
              connection === null
                ? 'neutral'
                : (STATUS_TONE[connection.status] ?? 'neutral')
            }
            className={
              connection?.status === 'CONNECTED'
                ? 'motion-safe:animate-pulse'
                : undefined
            }
          />
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {connection === null ? (
            <>
              <p className="text-sm text-muted-foreground">
                Not connected yet - source products from CJ&apos;s catalog using
                your own CJ account. Sals3 never sees your CJ password, only an
                encrypted API key you provide.
              </p>
              <ConnectCjDialog triggerLabel="Connect" />
            </>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-ink-muted">Connection</dt>
                <dd>{connection.displayName}</dd>
                <dt className="text-ink-muted">Account</dt>
                <dd className="font-mono text-xs">
                  {connection.externalAccountMasked}
                </dd>
                <dt className="text-ink-muted">Last verified</dt>
                <dd>
                  {connection.lastVerifiedAt
                    ? new Date(connection.lastVerifiedAt).toLocaleString()
                    : 'Never'}
                </dd>
              </dl>

              {needsReconnect ? (
                <>
                  <p className="text-sm text-ink-muted">
                    {RECONNECT_COPY[connection.status]}
                  </p>
                  <ConnectCjDialog
                    mode="reconnect"
                    triggerLabel="Reconnect"
                    triggerVariant="outline"
                  />
                </>
              ) : (
                <DisconnectCjButton />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
