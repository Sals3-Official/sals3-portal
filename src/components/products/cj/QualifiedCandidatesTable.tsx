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
import type { ReasonCode } from '@/modules/catalog/candidates/rules/contracts';
import {
  displayName,
  formatUsd,
  formatStock,
  stockedOrigins,
  totalStock,
} from './candidate-view';
import CustomizeAndListButton from './CustomizeAndListButton';

type QualifiedCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
  /** Whether to show the "Attention reasons" column (Needs Attention only). */
  showReasons: boolean;
};

const SHARED_COLUMNS = [
  'Product',
  'CJ product ID',
  'Supplier price',
  'Weight',
  'Available stock',
  'Stocked origins',
];

/**
 * Ready and Needs Attention share this table (spec's row field list): every
 * row here already passed automated evaluation - `PASS` or
 * `PASS_WITH_ATTENTION` - and is eligible for "Customize & List". No manual
 * shortlist action exists here; rows arrive automatically from the pipeline.
 */
export default function QualifiedCandidatesTable({
  candidates,
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
            const reasonCodes = candidate.evaluation
              .reasonCodes as ReasonCode[];

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
                <TableCell className="tabular-nums">
                  {formatUsd(candidate.evidence?.supplierPriceUsd ?? null)}
                </TableCell>
                <TableCell>
                  {candidate.evidence?.packedWeight
                    ? `${candidate.evidence.packedWeight} g`
                    : '—'}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatStock(totalStock(candidate.evidence))}
                </TableCell>
                <TableCell>{stockedOrigins(candidate.evidence)}</TableCell>
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
