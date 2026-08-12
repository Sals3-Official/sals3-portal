import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { candidateDrawerHref } from '@/lib/portal/pipeline-params';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import CandidateRow from './CandidateRow';
import { displayName } from './candidate-view';
import explainLastErrorCode from './last-error-code';

type ExceptionQueueTableProps = {
  candidates: EvaluatedCandidateRow[];
  /**
   * The page's current `?tab=`/`?q=`/`?page=`, so a row click adds
   * `?candidate=` without losing the view behind the drawer.
   */
  currentParams: Record<string, string>;
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
  currentParams,
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
            const name = displayName(candidate);

            return (
              <CandidateRow
                key={candidate.candidateId}
                href={candidateDrawerHref(currentParams, candidate.candidateId)}
                label={`Open candidate detail for ${name}`}
              >
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
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="inline-flex items-center gap-1">
                          <StatusPill
                            label={
                              candidate.evaluation.lastErrorCode ?? 'unknown'
                            }
                            tone="danger"
                          />
                          <Info
                            aria-label={`What "${candidate.evaluation.lastErrorCode ?? 'unknown'}" means`}
                            className="size-3.5 text-muted-foreground"
                          />
                        </span>
                      }
                    />
                    <TooltipContent>
                      {explainLastErrorCode(candidate.evaluation.lastErrorCode)}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="tabular-nums">
                  {candidate.evaluation.attemptCount}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {new Date(candidate.evaluation.updatedAt).toLocaleString()}
                </TableCell>
              </CandidateRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
