import Image from 'next/image';
import Link from 'next/link';
import { Package } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import presentEvaluationStatus from '@/components/products/cj/evaluation-status';
import { formatUsdCents } from '@/lib/cj/normalize';
import { buildHref } from '@/lib/portal/search-params';
import type { SupplierProductRow } from '@/modules/catalog/candidates/supplier-products-queries';
import {
  DiscoverySignalBadges,
  StockReviewBadge,
} from './SupplierProductBadges';

type SupplierProductsTableProps = {
  rows: SupplierProductRow[];
  currentParams: Record<string, string>;
};

const COLUMNS = [
  'Product',
  'Category',
  'Supplier price',
  'Signals',
  'Stock review',
  'Screening',
  'Source',
];

/**
 * The All Supplier Products table.
 *
 * A Server Component rendering rows that came from the Sals3 database. There
 * is no supplier client anywhere in this subtree, and the "Source details"
 * column is a plain link that opens a read-only drawer from the same
 * persisted data - opening it costs zero CJ requests.
 */
export default function SupplierProductsTable({
  rows,
  currentParams,
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
          {rows.map((row) => {
            const status = presentEvaluationStatus(
              row.status,
              row.attemptCount,
            );

            return (
              <TableRow
                key={row.candidateId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 md:table-row md:px-0 md:py-0"
              >
                <TableCell className="block w-full min-w-0 p-0 whitespace-normal md:table-cell md:w-full md:max-w-0 md:p-2">
                  <div className="flex items-center gap-3">
                    {row.imageUrl === null ? (
                      <div
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted"
                      >
                        <Package className="size-4 text-ink-faint" />
                      </div>
                    ) : (
                      <Image
                        src={row.imageUrl}
                        alt={row.name}
                        width={40}
                        height={40}
                        loading="lazy"
                        className="size-10 shrink-0 rounded-md border border-border object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={row.name}>
                        {row.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.sku ?? '—'} · CJ {row.externalProductId}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-ink-muted md:p-2">
                  {row.categoryName ?? '—'}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums whitespace-nowrap md:p-2">
                  {formatUsdCents(row.priceUsdCents)}
                </TableCell>
                <TableCell className="md:p-2">
                  <DiscoverySignalBadges signals={row.signals} />
                  {row.signals.length === 0 ? (
                    <span className="text-xs text-ink-faint">—</span>
                  ) : null}
                </TableCell>
                <TableCell className="md:p-2">
                  <StockReviewBadge state={row.stockReview.state} />
                </TableCell>
                <TableCell className="md:p-2">
                  <span title={status.description}>
                    <StatusPill label={status.label} tone={status.tone} />
                  </span>
                </TableCell>
                <TableCell className="md:p-2">
                  <Link
                    href={buildHref('/products', currentParams, {
                      source: row.candidateId,
                    })}
                    className="text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Source details
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
