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
import {
  REASON_CODE_EXPLANATIONS,
  type ReasonCode,
} from '@/modules/catalog/candidates/rules/contracts';
import RecheckNowButton from './RecheckNowButton';
import { displayName } from './candidate-view';

type BlockedCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
};

const COLUMNS = [
  'Product',
  'CJ product ID',
  'Decision',
  'Reasons',
  'Market',
  'Policy version',
  'Evaluated',
  'Permanent or retryable',
  'Action',
];

/**
 * Blocked/Rejected (spec's real page, not a placeholder). Shows every
 * `BLOCKED` (permanent, no override) and `TEMPORARILY_INELIGIBLE` (retryable)
 * candidate together, distinguished by the last column - matching the
 * spec's per-row "permanent or retryable" field rather than two separate
 * pages.
 */
export default function BlockedCandidatesTable({
  candidates,
}: BlockedCandidatesTableProps) {
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
            const reasonCodes = candidate.evaluation
              .reasonCodes as ReasonCode[];
            const isPermanent = candidate.evaluation.status === 'BLOCKED';

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
                    label={isPermanent ? 'Blocked' : 'Temporarily unavailable'}
                    tone={isPermanent ? 'danger' : 'warning'}
                  />
                </TableCell>
                <TableCell className="max-w-80">
                  <ul className="flex flex-col gap-1">
                    {reasonCodes.map((code) => (
                      <li key={code} className="text-xs">
                        <span className="font-mono font-medium text-foreground">
                          {code}
                        </span>
                        <p className="text-muted-foreground">
                          {REASON_CODE_EXPLANATIONS[code]}
                        </p>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  {candidate.intendedMarketCodes.join(', ')}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {candidate.evaluation.policyVersion}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {candidate.evaluation.evaluatedAt
                    ? new Date(
                        candidate.evaluation.evaluatedAt,
                      ).toLocaleString()
                    : '—'}
                </TableCell>
                <TableCell>{isPermanent ? 'Permanent' : 'Retryable'}</TableCell>
                <TableCell>
                  {isPermanent ? (
                    <span className="text-xs text-muted-foreground">
                      View details only
                    </span>
                  ) : (
                    <RecheckNowButton candidateId={candidate.candidateId} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
