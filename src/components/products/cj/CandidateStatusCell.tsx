import { TableCell } from '@/components/ui/table';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { ReasonCode } from '@/modules/catalog/candidates/rules/contracts';

type CandidateStatusCellProps = {
  /** Needs Attention lists its reason codes; Ready shows one green pill. */
  showReasons: boolean;
  reasonCodes: ReasonCode[];
};

/** The Status / Attention-reasons cell shared by the qualified-candidates rows. */
export default function CandidateStatusCell({
  showReasons,
  reasonCodes,
}: CandidateStatusCellProps) {
  if (!showReasons) {
    return (
      <TableCell>
        <StatusPill label="Ready" tone="success" />
      </TableCell>
    );
  }

  return (
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
  );
}
