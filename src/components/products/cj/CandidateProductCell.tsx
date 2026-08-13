import Image from 'next/image';
import { Package } from 'lucide-react';
import { TableCell } from '@/components/ui/table';
import StatusPill from '@/components/seller-center/shared/StatusPill';

type CandidateProductCellProps = {
  name: string;
  /** Host-checked by `imageUrl()`; null renders the placeholder box. */
  image: string | null;
  /** Adds the non-color "In catalogue" signal under the name. */
  inCatalogue: boolean;
};

/**
 * The image + name cell shared by the qualified-candidates rows.
 *
 * Extracted from `QualifiedCandidatesTable` when the selection column arrived
 * (the table was about to cross the 150-line rule), and it is where the "In
 * catalogue" pill lives - the pill, not only the row tint, is what tells a
 * colour-blind reviewer the candidate is already drafted (MASTER.md: colour is
 * never the only status signal).
 */
export default function CandidateProductCell({
  name,
  image,
  inCatalogue,
}: CandidateProductCellProps) {
  return (
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
        <div className="min-w-0">
          <p className="truncate" title={name}>
            {name}
          </p>
          {inCatalogue ? (
            <StatusPill label="In catalogue" tone="info" className="mt-0.5" />
          ) : null}
        </div>
      </div>
    </TableCell>
  );
}
