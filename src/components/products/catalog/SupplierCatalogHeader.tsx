import Link from 'next/link';
import PageHeader from '@/components/portal/PageHeader';
import { formatRelativeTime } from '@/lib/products/catalog-presentation';

type SupplierCatalogHeaderProps = {
  totalCount: number;
  activeSupplierCount: number;
  lastRefreshIso: string | null;
  nowIso: string;
};

/**
 * Page title plus the count line spec section 5 asks for: total results,
 * active supplier apps, last overall refresh, and a link to Manage Supplier
 * Apps. Reuses the existing `PageHeader` shell rather than a new title
 * block, so this still reads as one Seller Center.
 */
export default function SupplierCatalogHeader({
  totalCount,
  activeSupplierCount,
  lastRefreshIso,
  nowIso,
}: SupplierCatalogHeaderProps) {
  const supplierWord =
    activeSupplierCount === 1 ? 'supplier app' : 'supplier apps';
  const resultWord = totalCount === 1 ? 'product' : 'products';

  return (
    <PageHeader
      title="All Supplier Products"
      description="Browse products from your connected supplier apps. Automated evaluation runs in the background."
      actions={
        <div className="text-right text-xs text-muted-foreground">
          <p>
            {totalCount.toLocaleString()} {resultWord} · {activeSupplierCount}{' '}
            active {supplierWord}
            {lastRefreshIso === null
              ? ''
              : ` · refreshed ${formatRelativeTime(lastRefreshIso, nowIso)}`}
          </p>
          <Link href="/supplier-apps" className="underline underline-offset-2">
            Manage Supplier Apps
          </Link>
        </div>
      }
    />
  );
}
