import Link from 'next/link';
import { TableCell, TableRow } from '@/components/ui/table';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import { presentPublicationState } from '@/lib/seller-center/product-catalogue/status';
import type { CatalogueListingRow as Row } from '@/modules/catalog/products/catalogue-queries';

/**
 * One real catalogue row. Facts the database does not track yet render as
 * words ("Not priced yet"), never as a fabricated figure or an empty cell that
 * reads as zero.
 */
export default function CatalogueListingRow({ row }: { row: Row }) {
  const status = presentPublicationState(row.publicationState);

  return (
    <TableRow>
      <TableCell className="max-w-72 font-medium">
        <Link
          href={`/listings/${row.productId}`}
          className="underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="block truncate" title={row.title}>
            {row.title}
          </span>
        </Link>
        {row.revisionWorkflowState === 'DRAFT' ? (
          <span className="text-xs text-ink-subtle">Open draft revision</span>
        ) : null}
      </TableCell>
      <TableCell>
        <StatusPill label={status.label} tone={status.tone} />
      </TableCell>
      <TableCell className="tabular-nums">
        {row.variantCount === 0 ? (
          <span
            className="text-ink-muted"
            title="No supplier evidence was stored for this candidate, so no variants could be created."
          >
            No variants
          </span>
        ) : (
          row.variantCount
        )}
      </TableCell>
      <TableCell className="text-ink-muted">Not priced yet</TableCell>
      <TableCell>
        {row.externalProductId === null ? (
          <span className="text-ink-muted">No supplier reference</span>
        ) : (
          <div className="min-w-0">
            <p className="truncate font-mono text-xs">
              {row.externalProductId}
            </p>
            <p className="text-xs text-ink-subtle">
              {row.providerCode ?? 'Unknown provider'} ·{' '}
              {(row.sourceStatus ?? 'UNKNOWN').toLowerCase()} ·{' '}
              {(row.syncState ?? 'STALE').toLowerCase()}
            </p>
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
        {formatUtcDateTime(row.createdAt)}
      </TableCell>
    </TableRow>
  );
}
