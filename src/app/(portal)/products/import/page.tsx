import type { Metadata } from 'next';
import { Download } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';
import NoAccess from '@/components/portal/NoAccess';
import PageHeader from '@/components/portal/PageHeader';
import ImportPanel from '@/components/products/ImportPanel';
import { can } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Import and export · Sals3 Portal',
};

/** CSV import preview and export download. */
export default async function ImportProductsPage() {
  const session = await getSession();

  if (!can(session.role, 'product:import')) {
    return <NoAccess role={session.role} action="import products" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Import and export"
        description="Read a CSV file to check it, or download your products as a CSV file."
        actions={
          can(session.role, 'product:export') ? (
            <LinkButton
              href="/products/export"
              variant="outline"
              prefetch={false}
            >
              <Download aria-hidden="true" />
              Export CSV
            </LinkButton>
          ) : null
        }
      />
      <ImportPanel />
      <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-ink-muted">
        Bulk price, stock, and status updates through import are not built yet.
        Use the product list to change many products at once: select the rows
        and use the action bar.
      </p>
    </div>
  );
}
