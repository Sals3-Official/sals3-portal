import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import LinkButton from '@/components/portal/LinkButton';
import { candidateDrawerHref } from '@/lib/portal/pipeline-params';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import type { ReasonCode } from '@/modules/catalog/candidates/rules/contracts';
import CandidateProductCell from './CandidateProductCell';
import CandidateRow from './CandidateRow';
import CandidateSelectCheckbox from './CandidateSelectCheckbox';
import CandidateStatusCell from './CandidateStatusCell';
import SelectAllOnPageCheckbox from './SelectAllOnPageCheckbox';
import {
  displayName,
  formatUsd,
  imageUrl,
  supplierPriceUsd,
} from './candidate-view';
import CustomizeAndListButton from './CustomizeAndListButton';

type QualifiedCandidatesTableProps = {
  candidates: EvaluatedCandidateRow[];
  /** `?tab=`/`?q=`/`?page=`, so a row click adds `?candidate=` without losing the view. */
  currentParams: Record<string, string>;
  /** "Attention reasons" column (Needs Attention only). */
  showReasons: boolean;
  /** candidateId -> productId for rows already drafted. */
  inCatalogue: ReadonlyMap<string, string>;
};

/**
 * Ready and Needs Attention share this table: every row already passed
 * automated evaluation. The one seller action is selecting rows for "Add to
 * Product Catalogue". A row already drafted keeps its place - a candidate is a
 * sourcing record, not a queue entry - and is marked three ways: row tint,
 * "In catalogue" pill, disabled checkbox.
 */
export default function QualifiedCandidatesTable({
  candidates,
  currentParams,
  showReasons,
  inCatalogue,
}: QualifiedCandidatesTableProps) {
  const columns = [
    'Product',
    'CJ product ID',
    'Supplier price',
    showReasons ? 'Attention reasons' : 'Status',
    'Last checked',
    'Action',
  ];
  const eligibleIds = candidates
    .map((candidate) => candidate.candidateId)
    .filter((id) => !inCatalogue.has(id));

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <SelectAllOnPageCheckbox eligibleIds={eligibleIds} />
            </TableHead>
            {columns.map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => {
            const name = displayName(candidate);
            const productId = inCatalogue.get(candidate.candidateId);
            const reasonCodes = candidate.evaluation
              .reasonCodes as ReasonCode[];

            return (
              <CandidateRow
                key={candidate.candidateId}
                href={candidateDrawerHref(currentParams, candidate.candidateId)}
                label={`Open candidate detail for ${name}`}
                inCatalogue={productId !== undefined}
              >
                <TableCell className="w-10">
                  <CandidateSelectCheckbox
                    candidateId={candidate.candidateId}
                    name={name}
                    disabled={productId !== undefined}
                  />
                </TableCell>
                <CandidateProductCell
                  name={name}
                  image={imageUrl(candidate)}
                  inCatalogue={productId !== undefined}
                />
                <TableCell className="font-mono text-xs">
                  {candidate.externalProductId}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatUsd(supplierPriceUsd(candidate))}
                </TableCell>
                <CandidateStatusCell
                  showReasons={showReasons}
                  reasonCodes={reasonCodes}
                />
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {candidate.evaluation.evaluatedAt
                    ? new Date(
                        candidate.evaluation.evaluatedAt,
                      ).toLocaleString()
                    : '—'}
                </TableCell>
                <TableCell>
                  {productId === undefined ? (
                    <CustomizeAndListButton productName={name} />
                  ) : (
                    <LinkButton
                      href={`/listings/${productId}`}
                      variant="outline"
                      size="sm"
                    >
                      Open in catalogue
                    </LinkButton>
                  )}
                </TableCell>
              </CandidateRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
