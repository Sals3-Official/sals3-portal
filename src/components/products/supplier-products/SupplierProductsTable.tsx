import Image from 'next/image';
import { ExternalLink, Package } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cjProductPageUrl, formatUsdCents } from '@/lib/cj/normalize';
import type { LiveBrowseRow } from '@/modules/catalog/candidates/live-browse';

type SupplierProductsTableProps = {
  rows: LiveBrowseRow[];
};

const COLUMNS = ['Product', 'Category', 'Supplier price'];

/**
 * The All Supplier Products table: the live CJ `/product/list` page.
 *
 * Every field here (image, name, SKU, category, price) comes straight from
 * the live provider row. The product name opens CJ's own product page in a
 * new tab - note `cjProductPageUrl` infers that address from the pid, since
 * `/product/list` carries no URL field, so a dead link is this helper being
 * wrong rather than the product being gone.
 *
 * The pipeline overlay columns - Signals, Stock review, Screening, and the
 * Source drawer link - are hidden by owner request 2026-08-13. Nearly every
 * live row is undiscovered, so four columns of "Not discovered yet" filled
 * half the table with nothing. `LiveBrowseRow.match` still carries that data
 * for whoever brings the columns back; the loader is unchanged.
 */
export default function SupplierProductsTable({
  rows,
}: SupplierProductsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table className="block md:table">
        <TableHeader className="hidden md:table-header-group">
          <TableRow>
            {COLUMNS.map((column) => (
              <TableHead key={column} className="whitespace-nowrap">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="block md:table-row-group">
          {rows.map(({ live }) => (
            <TableRow
              key={live.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 md:table-row md:px-0 md:py-0"
            >
              <TableCell className="block w-full min-w-0 p-0 whitespace-normal md:table-cell md:w-full md:max-w-0 md:p-2">
                <div className="flex items-center gap-3">
                  {live.imageUrl === null ? (
                    <div
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted"
                    >
                      <Package className="size-4 text-ink-faint" />
                    </div>
                  ) : (
                    <Image
                      src={live.imageUrl}
                      alt={live.name}
                      width={40}
                      height={40}
                      loading="lazy"
                      className="size-10 shrink-0 rounded-md border border-border object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <a
                      href={cjProductPageUrl(live.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={live.name}
                      className="inline-flex max-w-full items-baseline gap-1 truncate font-medium hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="truncate">{live.name}</span>
                      <ExternalLink
                        aria-hidden="true"
                        className="size-3 shrink-0 text-ink-faint"
                      />
                    </a>
                    <p className="truncate text-xs text-muted-foreground">
                      {live.sku} · CJ {live.id}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-sm text-ink-muted md:p-2">
                {live.category}
              </TableCell>
              <TableCell className="text-right text-sm tabular-nums whitespace-nowrap md:p-2">
                {formatUsdCents(live.priceCentsUsd)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
