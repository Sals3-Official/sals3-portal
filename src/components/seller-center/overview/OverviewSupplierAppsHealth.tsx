import Link from 'next/link';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import {
  CONNECTION_STATUS_TEXT,
  initialsOf,
} from '@/components/supplier-apps/connection-presentation';
import type {
  SupplierConnectionRow,
  SupplierProviderRow,
} from '@/lib/db/schema';

export type OverviewConnectionHealthRow = {
  provider: SupplierProviderRow;
  connection: SupplierConnectionRow;
};

type OverviewSupplierAppsHealthProps = {
  rows: OverviewConnectionHealthRow[];
};

/**
 * Same identity-chip + status-pill idiom as `SupplierAppCard` (not a second
 * one) - a read-only summary here, with the real controls one click away at
 * `/supplier-apps`.
 */
export default function OverviewSupplierAppsHealth({
  rows,
}: OverviewSupplierAppsHealthProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Supplier Apps health</CardTitle>
        <CardDescription>
          {rows.length === 0
            ? 'Nothing connected yet.'
            : `${rows.length} ${rows.length === 1 ? 'connection' : 'connections'}.`}
        </CardDescription>
        <CardAction>
          <Link
            href="/supplier-apps"
            className="text-[12.5px] font-medium text-primary hover:underline"
          >
            Manage
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Connect a Supplier App to start sourcing.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map(({ provider, connection }) => {
              const status = CONNECTION_STATUS_TEXT[connection.status];

              return (
                <li
                  key={connection.id}
                  className="flex items-center gap-3 py-3"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar text-xs font-semibold text-sidebar-foreground"
                  >
                    {initialsOf(provider.displayName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">
                        {provider.displayName}
                      </p>
                      <StatusPill label={status.label} tone={status.tone} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {connection.externalAccountMasked}
                      {connection.lastVerifiedAt === null
                        ? ''
                        : ` · last verified ${connection.lastVerifiedAt.toLocaleDateString()}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
