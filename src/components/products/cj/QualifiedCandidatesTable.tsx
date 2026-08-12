import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { candidateDrawerHref } from '@/lib/portal/pipeline-params';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import type { ReasonCode } from '@/modules/catalog/candidates/rules/contracts';
import Image from 'next/image';
import { Package } from 'lucide-react';
import CandidateRow from './CandidateRow';
import {
  displayName,
  formatUsd,
  imageUrl,
  supplierPriceUsd,
} from './candidate-view';
import CustomizeAndListButton from './CustomizeAndListButton';

type QualifiedCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
  /**
   * The page's current `?tab=`/`?q=`/`?page=`, so a row click adds
   * `?candidate=` without losing the view behind the drawer.
   */
  currentParams: Record<string, string>;
  /** Whether to show the "Attention reasons" column (Needs Attention only). */
  showReasons: boolean;
};

const SHARED_COLUMNS = ['Product', 'CJ product ID', 'Supplier price'];

/**
 * Ready and Needs Attention share this table (spec's row field list): every
 * row here already passed automated evaluation - `PASS` or
 * `PASS_WITH_ATTENTION` - and is eligible for "Customize & List". No manual
 * shortlist action exists here; rows arrive automatically from the pipeline.
 */
export default function QualifiedCandidatesTable({
  candidates,
  currentParams,
  showReasons,
}: QualifiedCandidatesTableProps) {
  const columns = [
    ...SHARED_COLUMNS,
    showReasons ? 'Attention reasons' : 'Status',
    'Last checked',
    'Action',
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => {
            const name = displayName(candidate);
            const image = imageUrl(candidate);
            const reasonCodes = candidate.evaluation
              .reasonCodes as ReasonCode[];

            return (
              <CandidateRow
                key={candidate.candidateId}
                href={candidateDrawerHref(currentParams, candidate.candidateId)}
                label={`Open candidate detail for ${name}`}
              >
                <TableCell className="max-w-64 font-medium">
                  <div className="flex items-center gap-3">
                    {image === null ? (
                      <div
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted"
                      >
                        <Package className="size-4 text-ink-faint" />
                      </div>
                    ) : (
                      <Image
                        src={image}
                        alt={name}
                        width={40}
                        height={40}
                        loading="lazy"
                        className="size-10 shrink-0 rounded-md border border-border object-cover"
                      />
                    )}
                    <span className="min-w-0 truncate" title={name}>
                      {name}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {candidate.externalProductId}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatUsd(supplierPriceUsd(candidate))}
                </TableCell>
                {showReasons ? (
                  <TableCell>
                    {reasonCodes.length === 0 ? (
                      '—'
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {reasonCodes.map((code) => (
                          <li key={code}>
                            <StatusPill label={code} tone="warning" />
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                ) : (
                  <TableCell>
                    <StatusPill label="Ready" tone="success" />
                  </TableCell>
                )}
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {candidate.evaluation.evaluatedAt
                    ? new Date(
                        candidate.evaluation.evaluatedAt,
                      ).toLocaleString()
                    : '—'}
                </TableCell>
                <TableCell>
                  <CustomizeAndListButton productName={name} />
                </TableCell>
              </CandidateRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
