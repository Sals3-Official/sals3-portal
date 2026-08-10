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
import { displayName } from './candidate-view';

type AllCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
};

const COLUMNS = ['Product', 'CJ product ID', 'Status', 'Last updated'];

const STATUS_DISPLAY: Record<
  EvaluationStatus,
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
  EVALUATION_FAILED: { label: 'Exception', tone: 'danger' },
};

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
            const status = STATUS_DISPLAY[candidate.evaluation.status];

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
