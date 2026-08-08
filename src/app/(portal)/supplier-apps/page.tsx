import type { Metadata } from 'next';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import PageHeader from '@/components/portal/PageHeader';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import SourcingInfoBanner from '@/components/products/cj/SourcingInfoBanner';
import AvailableProviderCard from '@/components/supplier-apps/AvailableProviderCard';
import SupplierAppCard from '@/components/supplier-apps/SupplierAppCard';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import {
  countCandidateStatusSummary,
  mostRecentSnapshotAt,
} from '@/modules/catalog/candidates/queries';
import {
  listActiveProviders,
  listConnectionsBySeller,
} from '@/modules/suppliers/repository';
import type {
  SupplierConnectionRow,
  SupplierProviderRow,
} from '@/lib/db/schema';

export const metadata: Metadata = { title: 'Supplier Apps · Sals3 Portal' };
export const dynamic = 'force-dynamic';

type InstalledCard = {
  provider: SupplierProviderRow;
  connection: SupplierConnectionRow;
  lastSuccessfulSyncAt: Date | null;
};

/**
 * Supplier Apps (ADR-008): a Dropshipper's own curated provider connections.
 * Installed and Available both read the real `supplier_providers` /
 * `supplier_connections` tables - never a hardcoded provider list - so with
 * only `CJ_DROPSHIPPING` seeded today, exactly one of the two sections ever
 * has a real entry.
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
  const db = getDb();
  const [providers, connections, sourcingCounts] = await Promise.all([
    listActiveProviders(db),
    listConnectionsBySeller(db, sellerAccount.id),
    countCandidateStatusSummary(sellerAccount.id),
  ]);

  const installedCards = (
    await Promise.all(
      connections.map(async (connection): Promise<InstalledCard | null> => {
        const provider = providers.find((p) => p.id === connection.providerId);
        if (provider === undefined) return null;

        return {
          provider,
          connection,
          lastSuccessfulSyncAt: await mostRecentSnapshotAt(connection.id),
        };
      }),
    )
  ).filter((card): card is InstalledCard => card !== null);

  const connectedProviderIds = new Set(connections.map((c) => c.providerId));
  const availableProviders = providers.filter(
    (provider) => !connectedProviderIds.has(provider.id),
  );

  const installedSummary =
    installedCards.length === 0
      ? 'Nothing connected yet'
      : `${installedCards.length} ${installedCards.length === 1 ? 'connection' : 'connections'}`;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Supplier Apps"
        description="Connect your own supplier accounts. Product Sourcing only ever pulls from a connection here, and your credentials are encrypted at rest - Sals3 never shows them again."
      />

      <SourcingInfoBanner>
        Connect your own supplier account here (CJ Dropshipping today). Product
        Sourcing (Ready, Needs Attention, Evaluating, Blocked / Rejected,
        Exception Queue, All Supplier Products) only ever sources from a
        connection you set up on this screen.
      </SourcingInfoBanner>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-[15px] font-semibold">Installed</h2>
          <span className="text-xs text-muted-foreground">
            {installedSummary}
          </span>
        </div>
        {installedCards.length === 0 ? (
          <SourcingEmptyState
            title="Nothing connected yet"
            description="Connect a Supplier App below and Product Sourcing starts pulling from it automatically."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {installedCards.map(
              ({ provider, connection, lastSuccessfulSyncAt }) => (
                <SupplierAppCard
                  key={connection.id}
                  provider={provider}
                  connection={connection}
                  lastSuccessfulSyncAt={lastSuccessfulSyncAt}
                  sourcingCounts={sourcingCounts}
                />
              ),
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold">
            Available Supplier Apps
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Approved providers you can connect. Sals3 curates this list; you
            supply the account.
          </p>
        </div>
        {availableProviders.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            No other approved providers yet.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
            {availableProviders.map((provider) => (
              <AvailableProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
