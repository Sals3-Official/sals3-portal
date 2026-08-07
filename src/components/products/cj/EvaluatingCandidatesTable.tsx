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

type EvaluatingCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
};

const COLUMNS = ['Product', 'CJ product ID', 'Status', 'Queued/updated'];

/** Candidates currently `QUEUED` or `EVALUATING` in the automated pipeline. */
export default function EvaluatingCandidatesTable({
  candidates,
}: EvaluatingCandidatesTableProps) {
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
                    label={
                      candidate.evaluation.status === 'EVALUATING'
                        ? 'Evaluating'
                        : 'Queued'
                    }
                    tone={
                      candidate.evaluation.status === 'EVALUATING'
                        ? 'info'
                        : 'neutral'
                    }
                  />
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
