import { Button } from '@/components/ui/button';
import type { SupplierProviderRow } from '@/lib/db/schema';
import { initialsOf } from './connection-presentation';
import ConnectCjDialog from './ConnectCjDialog';

function capabilityBlurb(provider: SupplierProviderRow): string {
  const parts = [
    provider.capabilities.catalog && 'product catalogue',
    provider.capabilities.inventory && 'stock levels',
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0
    ? `Connect your own ${provider.displayName} account to read its ${parts.join(' and ')}.`
    : `Connect your own ${provider.displayName} account.`;
}

type AvailableProviderCardProps = {
  provider: SupplierProviderRow;
};

/**
 * An approved provider this seller hasn't connected yet. Only
 * `CJ_DROPSHIPPING` has a real connect action today (`ConnectCjDialog` calls
 * `connectCjSupplier`, which only ever talks to CJ's own API) - a provider
 * row without a real adapter behind it gets a disabled placeholder instead
 * of a button that would silently try to connect the wrong account.
 */
export default function AvailableProviderCard({
  provider,
}: AvailableProviderCardProps) {
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-sidebar text-xs font-semibold text-sidebar-foreground"
        >
          {initialsOf(provider.displayName)}
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold">
            {provider.displayName}
          </h3>
          <p className="mt-px text-[11.5px] text-muted-foreground">
            Approved provider
          </p>
        </div>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {capabilityBlurb(provider)}
      </p>
      {provider.code === 'CJ_DROPSHIPPING' ? (
        <ConnectCjDialog triggerLabel="Connect" />
      ) : (
        <Button type="button" variant="outline" disabled className="mt-auto">
          Not yet available to connect
        </Button>
      )}
    </article>
  );
}
