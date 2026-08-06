'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { CheckForSals3Result } from '@/app/(portal)/products/actions';
import CandidateEvidencePanel from './CandidateEvidencePanel';
import presentShortlistResult from './shortlist-status';

type ShortlistDrawerProps = {
  productName: string;
  result: CheckForSals3Result | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Detail panel for a shortlisted candidate.
 *
 * Spec section 8.14 describes a screening drawer with hard-gate results, score
 * components, rule version, and reason codes. Those do not exist yet, so this
 * shows what genuinely does: the stored candidate identifiers and fresh CJ
 * evidence (section 8.3) — facts, with no score or decision layered on top.
 */
export default function ShortlistDrawer({
  productName,
  result,
  open,
  onOpenChange,
}: ShortlistDrawerProps) {
  const presentation = presentShortlistResult(result);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        aria-label={`Sals3 shortlist detail for ${productName}`}
        className="overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>{productName}</SheetTitle>
          <SheetDescription>{presentation.label}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 text-sm text-ink-muted">
          <p>{presentation.description}</p>

          {result?.ok === true ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="font-medium text-foreground">Candidate ID</dt>
              <dd className="font-mono text-xs break-all">
                {result.candidateId}
              </dd>
              <dt className="font-medium text-foreground">State</dt>
              <dd>{result.shortlistState}</dd>
            </dl>
          ) : null}

          {/* Truthiness, not `!== null`: a payload missing the field entirely
              (an older client bundle after a deploy) must fall through to the
              "could not fetch" branch, not crash the row. */}
          {result?.ok === true && result.evidence ? (
            <CandidateEvidencePanel evidence={result.evidence} />
          ) : null}

          {result?.ok === true && !result.evidence ? (
            <p role="alert">
              CJ evidence could not be fetched, so none is shown. The candidate
              is still shortlisted — re-check it later.
            </p>
          ) : null}

          <p>
            Hard-gate results, a quality score, and a publish decision are not
            available: full preflight has not run for this candidate.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
