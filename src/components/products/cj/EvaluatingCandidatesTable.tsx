import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import StatusPill, {
  type StatusPillTone,
} from '@/components/seller-center/shared/StatusPill';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import { displayName } from './candidate-view';
import explainLastErrorCode from './last-error-code';

type EvaluatingCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
};

const COLUMNS = ['Product', 'CJ product ID', 'Status', 'Queued/updated'];

const STATUS_PRESENTATION: Record<
  string,
  { label: string; tone: StatusPillTone }
> = {
  QUEUED: { label: 'Queued', tone: 'neutral' },
  EVALUATING: { label: 'Evaluating', tone: 'info' },
  // A technical failure still under its automatic retry cap - see
  // `queries.ts#listEvaluatingCandidates`. An exhausted failure never
  // reaches this table; it belongs to the Exception Queue tab instead.
  EVALUATION_FAILED: { label: 'Retrying', tone: 'warning' },
};

/**
 * Candidates mid-pipeline: `QUEUED`/`EVALUATING`, or a technical evaluation
 * failure still auto-retrying. The retry reason and next scheduled check
 * (real `nextRetryAt`, never a guess) render underneath the status pill for
 * the retrying case - Bogs's queue/retry correctness slice explicitly
 * requires this be visible before a row ever reaches the Exception Queue.
 */
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
            const name = displayName(candidate);
            const presentation =
              STATUS_PRESENTATION[candidate.evaluation.status] ??
              STATUS_PRESENTATION.QUEUED;
            const isRetrying =
              candidate.evaluation.status === 'EVALUATION_FAILED';

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
                    label={presentation.label}
                    tone={presentation.tone}
                  />
                  {isRetrying ? (
                    <p className="mt-1 max-w-56 text-xs text-muted-foreground">
                      {explainLastErrorCode(candidate.evaluation.lastErrorCode)}
                      {candidate.evaluation.nextRetryAt === null
                        ? null
                        : ` Next check: ${new Date(candidate.evaluation.nextRetryAt).toLocaleString()}.`}
                    </p>
                  ) : null}
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
