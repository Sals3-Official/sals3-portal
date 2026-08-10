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
import type { EvaluationStatus } from '@/modules/catalog/candidates/rules/contracts';
import { MAX_EVALUATION_ATTEMPTS } from '@/modules/catalog/candidates/rules/policy';
import { displayName } from './candidate-view';

type AllCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
};

const COLUMNS = ['Product', 'CJ product ID', 'Status', 'Last updated'];

const STATUS_DISPLAY: Record<
  Exclude<EvaluationStatus, 'EVALUATION_FAILED'>,
  { label: string; tone: StatusPillTone }
> = {
  PASS: { label: 'Ready', tone: 'success' },
  PASS_WITH_ATTENTION: { label: 'Needs Attention', tone: 'warning' },
  QUEUED: { label: 'Queued', tone: 'neutral' },
  EVALUATING: { label: 'Evaluating', tone: 'info' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  TEMPORARILY_INELIGIBLE: {
    label: 'Temporarily unavailable',
    tone: 'warning',
  },
};

/**
 * `EVALUATION_FAILED` is not one label - see `pipeline-bucket.ts`: below the
 * automatic retry cap it is still retrying (same as Evaluating), at or past
 * it it genuinely is an exception. Labelling every `EVALUATION_FAILED` row
 * "Exception" regardless of `attemptCount` would overstate a row on its
 * first retry as already needing a person.
 */
function evaluationFailedDisplay(attemptCount: number): {
  label: string;
  tone: StatusPillTone;
} {
  return attemptCount >= MAX_EVALUATION_ATTEMPTS
    ? { label: 'Exception', tone: 'danger' }
    : { label: 'Retrying', tone: 'warning' };
}

/**
 * The "All" tab: every status in one glance, one row each. Deliberately
 * fewer columns than the per-status tables (Ready, Blocked/Rejected, etc.) -
 * this is an overview, not a replacement for the detail those tabs already
 * show per status.
 */
export default function AllCandidatesTable({
  candidates,
}: AllCandidatesTableProps) {
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
            const status =
              candidate.evaluation.status === 'EVALUATION_FAILED'
                ? evaluationFailedDisplay(candidate.evaluation.attemptCount)
                : STATUS_DISPLAY[candidate.evaluation.status];

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
                  <StatusPill label={status.label} tone={status.tone} />
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
