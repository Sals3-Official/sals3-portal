import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import LinkButton from '@/components/portal/LinkButton';
import type { CatalogueListingRow as Row } from '@/modules/catalog/products/catalogue-queries';
import CatalogueListingRow from './CatalogueListingRow';

const COLUMNS = [
  'Product',
  'Status',
  'Variants',
  'Selling price',
  'Supplier reference',
  'Created',
];

/**
 * The real catalogue table. An empty catalogue is not an error - it points at
 * Product Sourcing, where rows come from.
 */
export default function CatalogueTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-6">
        <p className="text-base font-semibold">Nothing in your catalogue yet</p>
        <p className="max-w-prose text-sm text-ink-muted">
          Products arrive here when you select qualified candidates on Product
          Sourcing and add them. They start as drafts - publishing is a
          separate, unbuilt step.
        </p>
        <LinkButton href="/products/pipeline?tab=ready" size="sm">
          Open Product Sourcing
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <CatalogueListingRow key={row.productId} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
