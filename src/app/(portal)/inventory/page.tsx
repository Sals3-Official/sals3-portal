import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import InventoryWorkspace from '@/components/seller-center/inventory/InventoryWorkspace';
import { requirePermission } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Inventory · Seller Center' };

/**
 * Inline stock edits with undo and a full audit trail. A thin Server
 * Component - the permission check is the only server-side logic here,
 * everything else lives in the independently-built client workspace.
 */
export default async function InventoryPage() {
  await requirePermission('inventory:read');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Inventory"
        description="Inline edits with undo and a full record of changes"
      />
      <InventoryWorkspace />
    </div>
  );
}
