import { cn } from '@/lib/utils';
import type { SupplierConnectionFixture } from '@/lib/products/catalog-types';
import SupplierConnectionHealth from './SupplierConnectionHealth';

type SupplierIdentityProps = {
  connection: SupplierConnectionFixture;
  /** `compact` drops the connected-account line - used in tight table cells. */
  variant?: 'default' | 'compact';
  className?: string;
};

/**
 * Permanent, provider-neutral source identity (spec section 8): every
 * supplier product must stay traceable to its provider and connected
 * account wherever it appears later - Ready, Needs Attention, the editor,
 * published listings, orders. Text + a logo chip + an accessible label, so
 * colour is never the only signal.
 */
export default function SupplierIdentity({
  connection,
  variant = 'default',
  className,
}: SupplierIdentityProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar text-xs font-semibold text-sidebar-foreground"
      >
        {connection.providerLogoInitial}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">
            {connection.providerDisplayName}
          </p>
          <SupplierConnectionHealth status={connection.status} />
        </div>
        {variant === 'default' ? (
          <p className="truncate text-xs text-muted-foreground">
            {connection.connectedAccountLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}
