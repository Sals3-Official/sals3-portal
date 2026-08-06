import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { ShortlistedCandidate } from '@/modules/catalog/candidates/queries';

type ShortlistedTableProps = {
  candidates: ShortlistedCandidate[];
};

const COLUMNS = ['Supplier product', 'Markets', 'State', 'Shortlisted'];

/**
 * Real shortlisted candidates read from Postgres. A Server Component: the
 * rows are read-only, so no client JavaScript ships for them.
 */
export default function ShortlistedTable({
  candidates,
}: ShortlistedTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((label) => (
              <TableHead key={label} className="whitespace-nowrap">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => (
            <TableRow key={candidate.id}>
              <TableCell className="font-mono text-xs">
                {candidate.externalProductId}
              </TableCell>
              <TableCell className="text-sm text-ink-muted">
                {candidate.intendedMarketCodes.join(', ')}
              </TableCell>
              <TableCell>
                <StatusPill label={candidate.shortlistState} tone="info" />
              </TableCell>
              <TableCell className="text-sm whitespace-nowrap text-ink-muted">
                {candidate.createdAt.toISOString().slice(0, 10)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
