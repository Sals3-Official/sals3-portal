import Image from 'next/image';
import { Package } from 'lucide-react';
import type { SupplierSourceIdentity } from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import { CONNECTION_STATUS_PRESENTATION } from './presentation';

type SupplierSourceBadgeProps = {
  source: SupplierSourceIdentity;
  /** `compact` drops the connected-account line for tight header rows. */
  variant?: 'default' | 'compact';
};

/**
 * Which supplier this draft came from, and whether that connection is
 * currently healthy.
 *
 * Provider-neutral by construction: the logo is optional and a provider
 * without one falls back to a generic icon, so adding a second Supplier
 * App needs an asset, not a code change. The provider name is always real
 * text - the logo is decorative and hidden from assistive technology,
 * because a logo alone is not an accessible name.
 *
 * The logo chip is dark on purpose: the supplied CJ asset is a white mark,
 * which would be invisible on a white card.
 */
export default function SupplierSourceBadge({
  source,
  variant = 'default',
}: SupplierSourceBadgeProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar p-1.5"
      >
        {source.providerLogoPath === undefined ? (
          <Package className="size-4 text-sidebar-foreground" />
        ) : (
          <Image
            src={source.providerLogoPath}
            alt=""
            width={24}
            height={24}
            className="size-full object-contain"
          />
        )}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium">
            {source.providerDisplayName}
          </p>
          <EditorStatusPill
            presentation={
              CONNECTION_STATUS_PRESENTATION[source.connectionStatus]
            }
          />
        </div>
        {variant === 'default' ? (
          <p className="truncate text-xs text-muted-foreground">
            {source.connectionDisplayName}
          </p>
        ) : null}
      </div>
    </div>
  );
}
