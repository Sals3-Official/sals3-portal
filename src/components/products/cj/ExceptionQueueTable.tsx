import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import { displayName } from './candidate-view';

type ExceptionQueueTableProps = {
  candidates: EvaluatedCandidateRow[];
};

const COLUMNS = [
  'Product',
  'CJ product ID',
  'Last error',
  'Attempts',
  'Last attempt',
];

/**
 * Dead-lettered evaluation failures only - genuine operational exceptions
 * (CJ repeatedly unavailable, retries exhausted), never ordinary rejected
 * products (those live on Blocked/Rejected instead).
 */
export default function ExceptionQueueTable({
  candidates,
}: ExceptionQueueTableProps) {
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
          {candidates.map((candidate) => {
            const name = displayName(
              candidate.externalProductId,
              candidate.evidence,
            );

            return (
              <TableRow key={candidate.candidateId}>
                <TableCell
                  className="max-w-64 truncate font-medium"
                  title={name}
                >
                  {name}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {candidate.externalProductId}
                </TableCell>
                <TableCell>
                  <StatusPill
                    label={candidate.evaluation.lastErrorCode ?? 'unknown'}
                    tone="danger"
                  />
                </TableCell>
                <TableCell className="tabular-nums">
                  {candidate.evaluation.attemptCount}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {new Date(candidate.evaluation.updatedAt).toLocaleString()}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
